// v82: the "patchy Firefox voice" report, part two — three fixes:
// 1. Transcripts ride inside JSON ({"transcript": …}); a model that answers
//    with an error sentence can never pose as dictation, and plain-text
//    error-shaped replies are dropped by the fallback guard.
// 2. Proxy segments are 15s (was 5s): one metered call per 15s of speech,
//    and 3× fewer boundaries for words to be clipped at.
// 3. The 429 message passes through from the proxy, which now meters voice
//    in its own pool (VOICE_DAILY) — server-side change; here we prove the
//    client surfaces the pool-specific message.
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

  const mk = async (proxyReply) => {
    const ctx = await browser.newContext({ permissions: ['microphone'], serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const proxyHits = [];
    await ctx.route('https://proxy.example/**', async route => {
      proxyHits.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill(proxyReply);
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      try { localStorage.setItem('onboarded', 'true'); } catch(e){}
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    });
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return {p, proxyHits};
  };
  const reply = (obj) => ({ status: 200, contentType: 'application/json',
    body: JSON.stringify({candidates: [{content: {parts: [{text: typeof obj === 'string' ? obj : JSON.stringify(obj)}]}}]}) });

  // ---------- 1. JSON transcript protocol ----------
  const A = await mk(reply({transcript: 'pick up bread on the way home'}));
  await A.p.click('#micBtn');
  await A.p.waitForTimeout(1500);
  await A.p.click('#micBtn');                     // stop → flush the only segment
  for (let i = 0; i < 16 && !A.proxyHits.length; i++) await A.p.waitForTimeout(500);
  check('v82: request asks for the JSON transcript schema',
    A.proxyHits.length >= 1 && A.proxyHits[0].generationConfig &&
    A.proxyHits[0].generationConfig.responseSchema.properties.transcript.type === 'STRING' &&
    /Never put apologies/.test(A.proxyHits[0].contents[0].parts.map(x => x.text || '').join(' ')));
  let landed = '';
  for (let i = 0; i < 12; i++){
    landed = await A.p.locator('#liveText').inputValue();
    if (/bread/.test(landed)) break;
    await A.p.waitForTimeout(400);
  }
  check('v82: the words land — not the JSON wrapper',
    landed.trim() === 'pick up bread on the way home');

  // ---------- 2. an error sentence can never pose as dictation ----------
  const B = await mk(reply('An error occurred while processing the audio.'));
  await B.p.click('#micBtn');
  await B.p.waitForTimeout(1500);
  await B.p.click('#micBtn');
  for (let i = 0; i < 16 && !B.proxyHits.length; i++) await B.p.waitForTimeout(500);
  await B.p.waitForTimeout(1500);
  check('v82: model error text is dropped, the box stays clean',
    (await B.p.locator('#liveText').inputValue()).trim() === '');
  const B2 = await mk(reply('water the ferns near the back door'));
  await B2.p.click('#micBtn');
  await B2.p.waitForTimeout(1500);
  await B2.p.click('#micBtn');
  for (let i = 0; i < 16 && !B2.proxyHits.length; i++) await B2.p.waitForTimeout(500);
  let plain = '';
  for (let i = 0; i < 12; i++){
    plain = await B2.p.locator('#liveText').inputValue();
    if (plain) break;
    await B2.p.waitForTimeout(400);
  }
  check('v82: plain-text replies with real words still land (old-proxy compat)',
    plain.trim() === 'water the ferns near the back door');

  // ---------- 3. 15-second segments on the metered path ----------
  const C = await mk(reply({transcript: 'segment test'}));
  check('v82: proxy mode records in 15s segments; whisper keeps 5s', await C.p.evaluate(() => {
    asrMode = 'proxy';
    const p = segMs();
    asrMode = 'local';
    const l = segMs();
    return p === 15000 && l === 5000;
  }));
  await C.p.click('#micBtn');
  await C.p.waitForTimeout(6500);                 // past the OLD 5s boundary…
  check('v82: at 6.5s nothing has been posted yet — the segment is still open',
    C.proxyHits.length === 0 && await C.p.evaluate(() => recording === true));
  await C.p.click('#micBtn');
  for (let i = 0; i < 16 && !C.proxyHits.length; i++) await C.p.waitForTimeout(500);
  check('v82: stopping flushes the take as one call', C.proxyHits.length === 1);

  // ---------- 4. the voice-pool 429 message reaches the user ----------
  const D = await mk({ status: 429, contentType: 'application/json',
    body: JSON.stringify({error: {message: 'daily voice limit reached — resets tomorrow'}}) });
  await D.p.click('#micBtn');
  await D.p.waitForTimeout(1500);
  await D.p.click('#micBtn');
  let toastText = '';
  for (let i = 0; i < 16; i++){
    toastText = await D.p.locator('#toast').textContent();
    if (/voice limit/.test(toastText)) break;
    await D.p.waitForTimeout(500);
  }
  check('v82: the user hears WHICH pool ran dry, plus the own-key escape hatch',
    /daily voice limit reached/.test(toastText) && /add your own key/.test(toastText));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
