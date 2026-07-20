// v96: developer functions — the AI path used to fail SILENTLY (a stale pasted
// key or a hit quota just left "built-in" chips with no explanation). Now every
// fallback is recorded with an honest reason + a throttled toast, and Settings
// gains a "Developer functions" section with a Test AI health check that walks
// config → sign-in → one real call and says exactly which step fails.
const { chromium } = require('playwright');

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

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n + (c ? '' : ' — ' + (extra || ''))); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: opts.managed === false ? 'window.MANAGED=null;' : MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    let quota = opts.quota != null ? opts.quota : 999;
    await ctx.route('https://proxy.example/**', async route => {
      if (quota <= 0){ await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({error:{message:'daily AI limit reached'}}) }); return; }
      quota--;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{content: {parts: [{text: 'OK'}]}}] }) });
    });
    await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
      if (opts.badKey){ await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({error:{message:'API key not valid'}}) }); return; }
      if (route.request().method() === 'GET'){
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({models:[{name:'models/gemini-2.5-flash', supportedGenerationMethods:['generateContent']}]}) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({candidates:[{content:{parts:[{text:'OK'}]}}]}) });
      }
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    if (opts.init) await p.addInitScript(opts.init);
    await p.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- 1. the section exists, collapsed, and a healthy chain passes ----------
  const A = await mk();
  await A.click('nav.tabs button[data-view="settings"]');
  check('Settings has a Developer functions section',
    /Developer functions/.test(await A.locator('#view-settings').textContent()));
  check('it ships collapsed — not in a normal user’s way',
    !(await A.evaluate(() => document.getElementById('devBlock').open)));
  await A.click('#devBlock summary');
  await A.click('#aiDiagBtn');
  await A.waitForTimeout(600);
  const diagA = await A.locator('#aiDiagOut').textContent();
  check('Test AI: reports the hosted route', /hosted AI service/.test(diagA), diagA.slice(0, 120));
  check('Test AI: sign-in step passes', /Signed in to the hosted service/.test(diagA));
  check('Test AI: live call succeeds with latency', /Live AI call succeeded in \d+ms/.test(diagA));
  check('no fallbacks recorded on a healthy device',
    /No AI fallbacks recorded/.test(await A.locator('#devLastFallback').textContent()));

  // copy diagnostics: version + route, never note content
  await A.click('nav.tabs button[data-view="capture"]');
  await A.fill('#liveText', 'my secret plumber note');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(800);
  await A.click('nav.tabs button[data-view="settings"]');
  await A.click('#copyDiagBtn');
  const clip = await A.evaluate(() => navigator.clipboard.readText());
  check('Copy diagnostics: has version + AI route', /Idea → Todo v96/.test(clip) && /AI route: hosted proxy/.test(clip));
  check('Copy diagnostics: never includes note content', !/plumber/.test(clip));

  // ---------- 2. quota exhausted: capture falls back LOUDLY, diag names the step ----------
  const B = await mk({ quota: 0 });
  await B.fill('#liveText', 'book the dentist tomorrow');
  await B.click('#saveIdeaBtn');
  await B.waitForTimeout(1000);
  check('capture still lands via the built-in engine',
    await B.evaluate(() => ideas[0] && ideas[0].engine === 'built-in'));
  check('the task toast keeps its moment first',
    /task.*live/i.test(await B.locator('#toast').textContent()));
  await B.waitForTimeout(3200);   // the WHY toast follows once the task toast has landed
  const toastB = await B.locator('#toast').textContent();
  check('the fallback toast says WHY', /Smart AI unavailable/.test(toastB) && /daily AI limit/.test(toastB), toastB.slice(0, 140));
  check('the fallback is recorded with reason + where', await B.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('aiLastFallback'));
    return f && /daily AI limit/.test(f.reason) && f.where === 'capture' && f.ts > 0;
  }));
  check('the toast is throttled — a second fallback stays quiet', await B.evaluate(() => {
    document.getElementById('toast').textContent = '';
    toastAiFallback();
    return document.getElementById('toast').textContent === '';
  }));
  await B.click('nav.tabs button[data-view="settings"]');
  await B.click('#devBlock summary');
  check('dev panel shows the last fallback',
    /Last AI fallback: .*daily AI limit/.test(await B.locator('#devLastFallback').textContent()));
  await B.click('#aiDiagBtn');
  await B.waitForTimeout(600);
  const diagB = await B.locator('#aiDiagOut').textContent();
  check('Test AI pinpoints the failing step (live call, quota)',
    /Signed in to the hosted service/.test(diagB) && /Live AI call failed/.test(diagB) && /daily AI limit/.test(diagB), diagB.slice(0, 160));

  // ---------- 3. the stale-pasted-key trap — diagnosed in one tap ----------
  const C = await mk({ badKey: true, init: () => localStorage.setItem('geminiKey', JSON.stringify('AIzaOLD-DEAD-KEY')) });
  await C.click('nav.tabs button[data-view="settings"]');
  await C.click('#devBlock summary');
  await C.click('#aiDiagBtn');
  await C.waitForTimeout(600);
  const diagC = await C.locator('#aiDiagOut').textContent();
  check('Test AI: names the pasted-key route and that it wins', /your own pasted Gemini key/.test(diagC) && /always wins/.test(diagC));
  check('Test AI: dead key fails at model discovery with the fix in the message',
    /Key rejected at model discovery/.test(diagC) && /clear the key/.test(diagC), diagC.slice(0, 200));

  // ---------- 4. no AI configured at all: honest, not broken ----------
  const D = await mk({ managed: false });
  await D.click('nav.tabs button[data-view="settings"]');
  await D.click('#devBlock summary');
  await D.click('#aiDiagBtn');
  await D.waitForTimeout(400);
  check('Test AI without any AI: says so plainly',
    /No AI configured/.test(await D.locator('#aiDiagOut').textContent()));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
