// v83: near-real-time cloud transcription — an accessibility requirement.
// One continuous recording streams 1s chunks; an adaptive tick transcribes
// the whole take so far and REPLACES the take's text with each richer
// result. Words appear while you're still speaking, early mistakes
// self-correct, and there are no segment boundaries to clip words at.
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

  // the mock transcript grows with each hit — like a real model re-hearing a
  // longer take: 'plant the' → 'plant the roses out front'
  const TRANSCRIPTS = ['plant the', 'plant the roses out front', 'plant the roses out front today'];
  const mk = async () => {
    const ctx = await browser.newContext({ permissions: ['microphone'], serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const proxyHits = [];
    await ctx.route('https://proxy.example/**', async route => {
      const t = TRANSCRIPTS[Math.min(proxyHits.length, TRANSCRIPTS.length - 1)];
      proxyHits.push(1);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{content: {parts: [{text: JSON.stringify({transcript: t})}]}}]}) });
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

  const A = await mk();
  await A.p.click('#micBtn');

  // ---------- 1. words appear WHILE still recording ----------
  let firstSeen = 0, boxWhileRec = '';
  const t0 = Date.now();
  for (let i = 0; i < 30; i++){
    await A.p.waitForTimeout(400);
    boxWhileRec = await A.p.locator('#liveText').inputValue();
    if (/plant the/.test(boxWhileRec)){ firstSeen = Date.now() - t0; break; }
  }
  check('v83: first words on screen while recording (within ~8s)',
    firstSeen > 0 && firstSeen < 8000 && await A.p.evaluate(() => recording === true));

  // ---------- 2. the take is ONE recording, streamed — no chopping ----------
  check('v83: chunks stream into one continuous take', await A.p.evaluate(() =>
    liveChunks.length >= 3 && recording === true && !!mediaRec));

  // ---------- 3. later ticks REPLACE — richer text, never duplicated ----------
  let grew = '';
  for (let i = 0; i < 30; i++){
    await A.p.waitForTimeout(500);
    grew = await A.p.locator('#liveText').inputValue();
    if (/roses out front/.test(grew)) break;
  }
  check('v83: the line grows in place as the model re-hears the take',
    /plant the roses out front/.test(grew) && !/plant the plant the/.test(grew));

  // ---------- 4. stop = one authoritative final pass ----------
  await A.p.click('#micBtn');
  await A.p.waitForTimeout(2500);
  const finalBox = await A.p.locator('#liveText').inputValue();
  check('v83: the final pass leaves exactly the last full transcript',
    finalBox.trim() === 'plant the roses out front today');
  check('v83: no duplicated fragments anywhere in the final text',
    !/plant the plant|front plant/.test(finalBox));

  // ---------- 5. typed text before the take survives in front of it ----------
  const B = await mk();
  await B.p.fill('#liveText', 'remember:');
  await B.p.click('#micBtn');
  await B.p.waitForTimeout(5500);
  await B.p.click('#micBtn');
  await B.p.waitForTimeout(2500);
  check('v83: dictation appends to what was already typed',
    /^remember: plant the/.test(await B.p.locator('#liveText').inputValue()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
