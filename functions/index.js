// AI proxy (P2) — a single Cloud Function that lets every app user reach Gemini
// through the OPERATOR's key, with per-user daily quotas, so no one pastes a
// key of their own. Deploy: see functions/README.md / .github/workflows/deploy-backend.yml.
//
// The client posts a Gemini generateContent body with a Firebase ID token in
// the Authorization header. This function verifies the token, checks/increments
// that user's daily counter in Firestore, injects the operator's key + model,
// forwards to Gemini, and returns the raw response.
//
// The key lives in Google Secret Manager (`firebase functions:secrets:set
// GEMINI_KEY`, or the CI workflow) — never in code, config files, or the
// client. One codebase serves both products: FN_REGION is set per project at
// deploy time (ideatodo: us-central1; cooee: australia-southeast1, so the
// only AU-exit is the model API call itself — see the build brief §Phase 5).

const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
admin.initializeApp();

const geminiKey = defineSecret('GEMINI_KEY');
// Model selection (v81): hardcoded names rot — Google retires models for new
// keys ("gemini-2.5-flash is no longer available to new users", July 2026).
// Unless GEMINI_MODEL pins one, discover the newest general-purpose flash
// model this key can use (same filter the client applies to pasted keys),
// cache it for the life of the warm instance, and rediscover once on a 404.
const MODEL_OVERRIDE = process.env.GEMINI_MODEL || '';
let cachedModel = null;
function chooseModel(models){
  const cands = (models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((n) => /^gemini-\d+(\.\d+)?-flash/.test(n) && !/preview|exp|image|tts|live|audio|thinking|8b/.test(n));
  cands.sort((a, b) => {
    const v = (n) => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    return v(b) - v(a) || a.length - b.length;   // newest version, then plainest name
  });
  return cands[0] || 'gemini-flash-latest';      // Google's rolling alias as the last resort
}
async function resolveModel(key, force){
  if (MODEL_OVERRIDE) return MODEL_OVERRIDE;
  if (cachedModel && !force) return cachedModel;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
    {headers: {'x-goog-api-key': key}});
  if (!r.ok) throw new Error('model discovery failed: ' + r.status);
  cachedModel = chooseModel((await r.json()).models);
  return cachedModel;
}
const FREE_DAILY = parseInt(process.env.FREE_DAILY || '30', 10);   // AI calls per user per day
// v82: voice transcription segments meter SEPARATELY. A dictation is many
// small calls (one per ~15s segment) — charged against the shared pool it
// emptied FREE_DAILY in seconds of speech (live-user report). 120 segments
// ≈ 30 minutes of dictation a day on the free tier.
const VOICE_DAILY = parseInt(process.env.VOICE_DAILY || '120', 10);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
// Region must be known during firebase-tools' source-analysis pass, which runs
// BEFORE .env files load and without the deploy shell's env — but it always
// sets GCLOUD_PROJECT. Map project → region here (cooee is AU-resident by
// design; the only AU-exit is the Gemini API call itself).
const REGION = process.env.FN_REGION ||
  ({'cooee-dbde6': 'australia-southeast1'}[process.env.GCLOUD_PROJECT] || 'us-central1');

const cors = (res) => {
  res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.set('Access-Control-Allow-Headers', 'authorization, content-type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
};

exports.ai = onRequest(
  {region: REGION, secrets: [geminiKey], invoker: 'public', maxInstances: 5},
  async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if (req.method !== 'POST'){ res.status(405).json({error: {message: 'POST only'}}); return; }
  const GEMINI_KEY = geminiKey.value() || process.env.GEMINI_KEY;
  if (!GEMINI_KEY){ res.status(500).json({error: {message: 'proxy not configured: set GEMINI_KEY'}}); return; }

  // 1. verify the caller
  const authz = req.get('authorization') || '';
  const m = authz.match(/^Bearer (.+)$/);
  if (!m){ res.status(401).json({error: {message: 'missing auth token'}}); return; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(m[1])).uid; }
  catch (e){ res.status(401).json({error: {message: 'invalid auth token'}}); return; }

  // 2. per-user daily quotas — voice segments and AI calls are separate pools
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const isVoice = Array.isArray(body.contents) && body.contents.some((c) =>
    Array.isArray(c && c.parts) && c.parts.some((p) =>
      p && p.inlineData && /^audio\//.test(p.inlineData.mimeType || '')));
  const field = isVoice ? 'voice' : 'count';
  const day = new Date().toISOString().slice(0, 10);
  const ref = admin.firestore().doc(`aiQuota/${uid}`);
  try {
    const allowed = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const sameDay = d.day === day;               // a new day resets BOTH pools
      const count = sameDay ? (d.count || 0) : 0;
      const voice = sameDay ? (d.voice || 0) : 0;
      if ((isVoice ? voice : count) >= (isVoice ? VOICE_DAILY : FREE_DAILY)) return false;
      tx.set(ref, {day, count: count + (isVoice ? 0 : 1), voice: voice + (isVoice ? 1 : 0),
                   updated: Date.now()}, {merge: true});
      return true;
    });
    if (!allowed){
      res.status(429).json({error: {message: isVoice
        ? 'daily voice limit reached — resets tomorrow'
        : 'daily AI limit reached — resets tomorrow'}});
      return;
    }
  } catch (e){ res.status(500).json({error: {message: 'quota check failed'}}); return; }

  // 3. forward to Gemini with the operator's key + chosen model
  // audio rides inside contents as inline base64 — cap the payload so a
  // client can't relay arbitrarily large uploads through the operator's key
  // (~4 MB ≈ several minutes of compressed speech; the app's own free-tier
  // capture cap sits well under this)
  if (JSON.stringify(body).length > 4 * 1024 * 1024){
    res.status(413).json({error: {message: 'audio too long for one request'}});
    return;
  }
  // never let the client pick the model/key; strip anything unexpected
  const forward = {
    contents: body.contents,
    generationConfig: body.generationConfig,
    systemInstruction: body.systemInstruction
  };
  try {
    const call = async (model) => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {method: 'POST', headers: {'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY},
       body: JSON.stringify(forward)});
    let model = await resolveModel(GEMINI_KEY);
    let r = await call(model);
    if (r.status === 404 && !MODEL_OVERRIDE){
      // the cached (or first-guess) model was retired mid-flight — rediscover once
      model = await resolveModel(GEMINI_KEY, true);
      r = await call(model);
    }
    // a failed upstream call must not eat the user's quota — refund it
    if (r.status >= 400)
      ref.set({[field]: admin.firestore.FieldValue.increment(-1)}, {merge: true}).catch(() => {});
    // Google's own 429 talks about "your plan and billing details" — that is a
    // message for the OPERATOR (the shared key is out of capacity), not for
    // the person dictating. Translate it; log the real one for the operator.
    if (r.status === 429){
      console.error('UPSTREAM GEMINI QUOTA HIT (operator key at capacity):', (await r.text()).slice(0, 300));
      res.status(503).json({error: {message: 'the shared AI service is at capacity right now — it retries itself in a moment', transient: true}});
      return;
    }
    const text = await r.text();
    res.status(r.status).set('content-type', 'application/json').send(text);
  } catch (e){
    ref.set({[field]: admin.firestore.FieldValue.increment(-1)}, {merge: true}).catch(() => {});
    res.status(502).json({error: {message: 'upstream error: ' + e.message}});
  }
});
