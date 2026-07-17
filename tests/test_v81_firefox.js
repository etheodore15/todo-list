// v81: the Firefox voice regression, from a live production screenshot.
// Two bugs, one screen:
// 1. The pre-v77 "Firefox doesn't support voice" banner still showed above a
//    WORKING cloud recorder. It now appears only when the build truly has no
//    transcription path (voiceMode() === 'none').
// 2. The proxy hardcoded gemini-2.5-flash, which Google retired for new keys
//    (API 404 mid-recording). The function now auto-discovers like the client;
//    here we prove the client-side pieces: the discovery fallback no longer
//    names a mortal model, and the proxy voice path works under a Firefox UA.
const { chromium } = require('playwright');

const FIREFOX_UA = 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0';
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

  const mk = async (cfgBody) => {
    // Firefox UA + no SpeechRecognition = what real Firefox presents
    const ctx = await browser.newContext({ userAgent: FIREFOX_UA, permissions: ['microphone'], serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfgBody }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const proxyHits = [];
    await ctx.route('https://proxy.example/**', async route => {
      proxyHits.push(1);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{content: {parts: [{text: 'water the garden'}]}}]}) });
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

  // ---------- 1. managed build (production shape): no banner, voice works ----------
  const A = await mk(MANAGED);
  check('v81: Firefox + cloud path → voice mode is proxy',
    await A.p.evaluate(() => voiceMode() === 'proxy'));
  check('v81: the "Firefox doesn\'t support voice" banner is GONE',
    await A.p.locator('.browser-warn').count() === 0);
  await A.p.click('#micBtn');
  let started = false;
  for (let i = 0; i < 10 && !started; i++){
    await A.p.waitForTimeout(300);
    started = await A.p.evaluate(() => recording === true);
  }
  check('v81: recording starts in Firefox', started);
  await A.p.waitForTimeout(5600);
  await A.p.click('#micBtn');
  for (let i = 0; i < 16 && !A.proxyHits.length; i++) await A.p.waitForTimeout(500);
  check('v81: segments reach the proxy from a Firefox UA', A.proxyHits.length >= 1);
  check('v81: transcript lands in the capture box', await A.p.evaluate(async () => {
    for (let i = 0; i < 10; i++){
      if (/water the garden/.test(document.getElementById('liveText').value)) return true;
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }));

  // ---------- 2. self-hosted build with no proxy: honest banner stays ----------
  const B = await mk('window.MANAGED = null;');
  check('v81: no transcription path at all → the banner shows, honestly worded',
    await B.p.locator('.browser-warn').count() === 1 &&
    /no built-in speech engine/.test(await B.p.locator('.browser-warn').textContent()) &&
    /Typing works fully/.test(await B.p.locator('.browser-warn').textContent()));
  check('v81: the old false claim is gone from the new copy',
    !/doesn't support voice input or on-device AI/.test(await B.p.locator('.browser-warn').textContent()));

  // ---------- 3. the model fallback no longer names a mortal model ----------
  check('v81: empty discovery falls back to the rolling alias', await A.p.evaluate(() =>
    chooseGeminiModel([]) === 'gemini-flash-latest'));
  check('v81: discovery still prefers the newest real flash model', await A.p.evaluate(() =>
    chooseGeminiModel([
      {name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent']},
      {name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent']},
      {name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent']}
    ]) === 'gemini-3-flash'));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
