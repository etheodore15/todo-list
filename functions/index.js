// AI proxy (P2) — a single Cloud Function that lets every app user reach Gemini
// through the OPERATOR's key, with per-user daily quotas, so no one pastes a
// key of their own. Deploy: see functions/README.md.
//
// The client posts a Gemini generateContent body with a Firebase ID token in
// the Authorization header. This function verifies the token, checks/increments
// that user's daily counter in Firestore, injects the operator's key + model,
// forwards to Gemini, and returns the raw response.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const GEMINI_KEY = process.env.GEMINI_KEY || (functions.config().gemini || {}).key;
const MODEL = process.env.GEMINI_MODEL || (functions.config().gemini || {}).model || 'gemini-2.5-flash';
const FREE_DAILY = parseInt(process.env.FREE_DAILY || '30', 10);   // AI calls per user per day
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const cors = (res) => {
  res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.set('Access-Control-Allow-Headers', 'authorization, content-type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
};

exports.ai = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if (req.method !== 'POST'){ res.status(405).json({error: {message: 'POST only'}}); return; }
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
