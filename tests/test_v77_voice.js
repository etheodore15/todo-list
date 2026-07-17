// v77: cloud transcription via the AI proxy — the path of least resistance.
// - Where the browser has no speech engine (iOS Safari, Firefox), managed
//   builds record with MediaRecorder and transcribe 5s segments through the
//   proxy: nothing to download, nothing to install.
// - On-device Whisper is demoted to an explicit privacy option in Settings.
// - The metered (proxy) path carries the free-tier per-capture cap
//   (FLAVOR.limits.voiceSeconds) — the first premium lever (MONETIZATION.md).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1', aiProxy:'https://proxy.example/ai'};`;
  const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
  const FAKE_AUTH = `
    export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
    export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
    export async function signInAnonymously(a){ a.currentUser={uid:'u1', getIdToken: async()=>'TOKEN-123'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
  const FAKE_FS = `
    export function initializeFirestore(){ return {}; }
    export function persistentLocalCache(){ return {}; }
    export function collection(db,...p){ return {path:p.join('/')}; }
    export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
    export async function setDoc(){} export async function deleteDoc(){}
    export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
    export function onSnapshot(col,cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;

  const mkPage = async (opts = {}) => {
    const ctx = await browser.newContext({ permissions: ['microphone'], serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript',
      body: (opts.managed === false ? 'window.MANAGED=null;' : MANAGED) + (opts.flavor || '') }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const proxyHits = [];
    await ctx.route('https://proxy.example/**', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      proxyHits.push({auth: route.request().headers()['authorization'], body});
      if (opts.proxyFail){ await route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({error:{message:'invalid auth token'}}) }); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{content: {parts: [{text: 'buy milk and call the plumber'}]}}]}) });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    if (opts.noSR) await page.addInitScript(() => {
      try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch(_){}
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    });
    await page.addInitScript(() => { try { localStorage.setItem('onboarded', 'true'); } catch(e){} });
    if (opts.init) await page.addInitScript(opts.init);
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return {page, proxyHits, ctx};
  };

  // ---------- 1. no browser speech engine + managed build → proxy mode ----------
  const A = await mkPage({noSR: true});
  check('v77: no SR + proxy → voice mode is proxy', await A.page.evaluate(() => voiceMode() === 'proxy'));
  check('v77: mic hint says just tap — no download talk',
    /Tap the mic/.test(await A.page.locator('#micHint').textContent()));
  await A.page.click('#micBtn');
  let started = false;
  for (let i = 0; i < 10 && !started; i++){
    await A.page.waitForTimeout(300);
    started = await A.page.evaluate(() => recording === true && !!mediaStream);
  }
  check('v77: recording starts (no install, no model download)', started);
  await A.page.waitForTimeout(6000);   // first 5s segment closes and posts
  await A.page.click('#micBtn');       // stop → final segment
  for (let i = 0; i < 20 && !A.proxyHits.length; i++) await A.page.waitForTimeout(500);
  if (!A.proxyHits.length) console.log('DEBUG toast:', await A.page.locator('#toast').textContent(),
    '| hint:', await A.page.locator('#micHint').textContent());
  check('v77: segments reached the proxy with the auth token',
    A.proxyHits.length >= 1 && A.proxyHits.every(h => h.auth === 'Bearer TOKEN-123'));
  const part = (((A.proxyHits[0] || {}).body || {}).contents || [{}])[0].parts || [];
  check('v77: request carries inline audio + a transcribe instruction',
    part.some(p => p.inlineData && /audio/.test(p.inlineData.mimeType)) &&
    part.some(p => /Transcribe this audio/.test(p.text || '')));
  for (let i = 0; i < 10; i++){
    if (/plumber/.test(await A.page.locator('#liveText').inputValue())) break;
    await A.page.waitForTimeout(500);
  }
  check('v77: transcript landed in the capture box',
    /buy milk and call the plumber/.test(await A.page.locator('#liveText').inputValue()));

  // ---------- 2. free-tier cap on the metered path (premium lever) ----------
  const B = await mkPage({noSR: true, flavor: 'window.FLAVOR={limits:{voiceSeconds:2}};'});
  await B.page.click('#micBtn');
  await B.page.waitForTimeout(600);
  check('v77: cap configured via flavor limits', await B.page.evaluate(() => voiceCapS() === 2));
  await B.page.waitForTimeout(2600);
  check('v77: capture auto-stops at the cap', await B.page.evaluate(() => recording === false));
  check('v77: cap toast keeps it kind and names Premium',
    /everything you said is kept/i.test(await B.page.locator('#toast').textContent()) &&
    /Premium/.test(await B.page.locator('#toast').textContent()));

  // ---------- 3. mode ladder ----------
  const C = await mkPage({});   // SR available (headless chromium has webkitSpeechRecognition)
  check('v77: browser engine preferred when it exists', await C.page.evaluate(() => voiceMode() === 'sr'));
  check('v77: explicit on-device opt-in wins over everything', await C.page.evaluate(() => {
    store.set('localASR', true);
    const m = voiceMode();
    store.set('localASR', false);
    return m === 'local';
  }));
  const D = await mkPage({managed: false, noSR: true});
  check('v77: self-hosted without SR still points to the on-device option',
    /on-device voice/i.test(await D.page.locator('#micHint').textContent()) &&
    await D.page.evaluate(() => voiceMode() === 'none'));

  // ---------- 4. settings demotion: privacy option, not a prerequisite ----------
  await C.page.click('nav.tabs button[data-view="settings"]');
  const setText = await C.page.evaluate(() => document.getElementById('asrBtn').closest('.set-block').textContent);
  check('v77: settings frame on-device ASR as an optional privacy mode',
    /works out of the box/i.test(setText) && /privacy/i.test(setText) && /nothing you say ever leaves/i.test(setText));
  check('v77: the download button is no longer the loud primary', await C.page.evaluate(() =>
    document.getElementById('asrBtn').classList.contains('ghost')));

  // ---------- 5. proxy failure surfaces one honest toast, take continues ----------
  const E = await mkPage({noSR: true, proxyFail: true});
  await E.page.click('#micBtn');
  await E.page.waitForTimeout(16500);   // v82: proxy segments close at 15s now
  check('v77: proxy failure → one kind toast, recording keeps going',
    /Transcription hiccup/.test(await E.page.locator('#toast').textContent()) &&
    await E.page.evaluate(() => recording === true));
  await E.page.click('#micBtn');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
