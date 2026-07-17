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
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FREE_DAILY = parseInt(process.env.FREE_DAILY || '30', 10);   // AI calls per user per day
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

  // 2. per-user daily quota (atomic increment in a transaction)
  const day = new Date().toISOString().slice(0, 10);
  const ref = admin.firestore().doc(`aiQuota/${uid}`);
  try {
    const allowed = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const used = d.day === day ? (d.count || 0) : 0;
      if (used >= FREE_DAILY) return false;
      tx.set(ref, {day, count: used + 1, updated: Date.now()}, {merge: true});
      return true;
    });
    if (!allowed){ res.status(429).json({error: {message: 'daily AI limit reached'}}); return; }
  } catch (e){ res.status(500).json({error: {message: 'quota check failed'}}); return; }

  // 3. forward to Gemini with the operator's key + chosen model
  const body = req.body && typeof req.body === 'object' ? req.body : {};
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
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {method: 'POST', headers: {'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY},
       body: JSON.stringify(forward)});
    const text = await r.text();
    res.status(r.status).set('content-type', 'application/json').send(text);
  } catch (e){
    res.status(502).json({error: {message: 'upstream error: ' + e.message}});
  }
});
