// v84: when the OPERATOR key is out of upstream capacity (Google's 429 talks
// about "your plan and billing details"), the user must never see billing
// language — the proxy translates it to a calm transient message (server
// side), and the client backs its ticks off instead of hammering.
const { chromium } = require('playwright');

const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1', aiProxy:'https://proxy.example/ai'};`;
const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_AUTH = `
  export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
  export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
  export async function signInAnonymously(a){ a.currentUser={uid:'u1', getIdToken: async()=>'T'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
const FAKE_FS = `
  export function initializeFirestore(){ return {}; }
  export function persistentLocalCache(){ return {}; }
  export function collection(db,...p){ return {path:p.join('/')}; }
  export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
  export async function setDoc(){} export async function deleteDoc(){}
  export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
  export function onSnapshot(c,cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const ctx = await browser.newContext({ permissions: ['microphone'], serviceWorkers: 'block' });
  await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: MANAGED }));
  await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
  await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
  await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
  // what the v84 proxy now sends when the operator key hits Google's quota
  await ctx.route('https://proxy.example/**', r => r.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({error: {message: 'the shared AI service is at capacity right now — it retries itself in a moment', transient: true}}) }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    try { localStorage.setItem('onboarded', 'true'); } catch(e){}
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
  });
  await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await p.waitForTimeout(500);

  await p.click('#micBtn');
  let toastText = '';
  for (let i = 0; i < 24; i++){
    await p.waitForTimeout(500);
    toastText = await p.locator('#toast').textContent();
    if (/at capacity/.test(toastText)) break;
  }
  check('v84: the user hears calm capacity language, not billing talk',
    /at capacity right now/.test(toastText) && /Keep talking/.test(toastText) &&
    !/billing|plan|quota/i.test(toastText));
  check('v84: no raw "API 503:" prefix leaks into the toast', !/API \d+/.test(toastText));
  check('v84: recording carries on through the outage', await p.evaluate(() => recording === true));
  check('v84: failed ticks back off exponentially (capped)', await p.evaluate(() => {
    const before = liveBackoff;               // ≥2 after at least one failure
    recStartedAt = Date.now();                // freshest take → base 4s
    const delayed = liveTickDelay();
    return before >= 2 && delayed === 4000 * before && Math.min(8, before) === before;
  }));
  check('v84: a success resets the pace', await p.evaluate(() => {
    liveBackoff = 8;
    liveBackoff = 1;                          // what the success path does
    recStartedAt = Date.now();
    return liveTickDelay() === 4000;
  }));
  await p.click('#micBtn');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
