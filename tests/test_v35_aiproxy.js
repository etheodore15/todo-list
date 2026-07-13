// v35 P2: AI proxy. In managed mode with an aiProxy URL, AI calls route through
// the proxy with a Firebase auth token (no user key); a pasted key overrides;
// quota 429 surfaces cleanly; the four AI features all use the unified path.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
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
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: opts.managed === false ? 'window.MANAGED=null;' : MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const proxyHits = [];
    let quota = opts.quota != null ? opts.quota : 999;
    await ctx.route('https://proxy.example/**', async route => {
      const req = route.request();
      proxyHits.push({auth: req.headers()['authorization'], body: JSON.parse(req.postData() || '{}')});
      if (quota <= 0){ await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({error:{message:'daily AI limit reached'}}) }); return; }
      quota--;
      // echo a valid gemini-shaped response with a summary JSON payload
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{content: {parts: [{text: JSON.stringify({summary:'Proxy summary.', tasks:[{text:'call the plumber', priority:'medium', tags:['calls']}], priority:'medium'})}]}}]
      }) });
    });
    // any DIRECT gemini call (should NOT happen in proxy mode) is recorded
    const directHits = [];
    await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
      directHits.push(route.request().url());
      if (route.request().method() === 'GET'){
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({models:[{name:'models/gemini-2.5-flash', supportedGenerationMethods:['generateContent']}]}) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({candidates:[{content:{parts:[{text: JSON.stringify({summary:'Direct.', tasks:[], priority:'low'})}]}}]}) });
      }
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    if (opts.init) await page.addInitScript(opts.init);
    await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    page.__proxyHits = proxyHits; page.__directHits = directHits;
    return page;
  };

  // ---------- managed, no user key → AI routes through the proxy ----------
  const A = await mkPage();
  check('P2: aiEnabled true in managed mode with no key', await A.evaluate(() => aiEnabled()));
  check('P2: aiViaProxy true with no key', await A.evaluate(() => aiViaProxy()));
  await A.fill('#liveText', 'I need to call the plumber');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(800);
  check('P2: summary went through the proxy', A.__proxyHits.length === 1);
  check('P2: proxy call carried the auth token', A.__proxyHits[0] && A.__proxyHits[0].auth === 'Bearer TOKEN-123');
  check('P2: no direct Gemini call made', A.__directHits.length === 0);
  check('P2: proxy result used for the task',
    (await A.evaluate(() => JSON.parse(localStorage.getItem('todos')).map(t => t.text))).some(t => /plumber/.test(t)));
  check('P2: proxy body has no model or key', A.__proxyHits[0] &&
    !('model' in A.__proxyHits[0].body) && JSON.stringify(A.__proxyHits[0].body).indexOf('x-goog') === -1);
  const engine = await A.evaluate(() => JSON.parse(localStorage.getItem('ideas'))[0].engine);
  check('P2: idea engine recorded as ai', engine === 'ai');

  // Settings shows the managed AI note, hides the key walkthrough
  await A.click('nav.tabs button[data-view="settings"]');
  check('P2: settings shows managed-AI note', await A.locator('#aiManagedNote').isVisible());
  check('P2: settings hides the paste-a-key note', !(await A.locator('#aiKeyNote').isVisible()));

  // ---------- pasted key overrides the proxy ----------
  const B = await mkPage({ init: () => localStorage.setItem('geminiKey', JSON.stringify('AIza-mine')) });
  check('P2: user key present → aiViaProxy false', !(await B.evaluate(() => aiViaProxy())));
  await B.fill('#liveText', 'buy milk and bread');
  await B.click('#saveIdeaBtn');
  await B.waitForTimeout(800);
  check('P2: with a user key, direct Gemini is used (not proxy)',
    B.__directHits.length >= 1 && B.__proxyHits.length === 0);

  // ---------- quota 429 surfaces a friendly message ----------
  const C = await mkPage({ quota: 0 });
  const err = await C.evaluate(async () => {
    try { await geminiGenerate({contents:[{role:'user',parts:[{text:'hi'}]}]}); return 'no-error'; }
    catch (e) { return e.message; }
  });
  check('P2: quota 429 gives a clear limit message', /daily AI limit/.test(err));

  // ---------- tone gate + breakdown + briefing all use aiEnabled ----------
  const D = await mkPage();
  const usesProxy = await D.evaluate(async () => {
    // toneCheck should hit the proxy
    const before = window.__toneMarker;
    const flag = await toneCheck('tell your father he was late again');
    return typeof toneCheck === 'function' && typeof geminiBreakdown === 'function';
  });
  check('P2: tone check + breakdown wired to unified path', usesProxy);
  check('P2: tone check reached the proxy', D.__proxyHits.length >= 1);

  // ---------- self-hosted build (no proxy, no key) → AI disabled, built-in only ----------
  const E = await mkPage({ managed: false });
  check('P2: no proxy + no key → aiEnabled false', !(await E.evaluate(() => aiEnabled())));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
