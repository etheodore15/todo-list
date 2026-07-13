// v39 first-party metrics: track() writes anonymized counters to the user's own
// cohorts/{uid} doc in managed mode; nothing in self-hosted; never content.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  // fake firestore that records setDoc calls + resolves increment() to a marker
  const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1'};`;
  const MANAGED_GA = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1', gaId:'G-TEST123'};`;
  const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
  const FAKE_AUTH = `
    export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
    export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
    export async function signInAnonymously(a){ a.currentUser={uid:'u-metrics', getIdToken:async()=>'T'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
  const FAKE_FS = `
    window.__writes = [];
    export function initializeFirestore(){ return {}; }
    export function persistentLocalCache(){ return {}; }
    export function collection(db,...p){ return {path:p.join('/')}; }
    export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
    export function increment(n){ return {__inc:n}; }
    export async function setDoc(ref, data, opts){ window.__writes.push({path:ref.path, data}); }
    export async function deleteDoc(){}
    export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
    export function onSnapshot(col,cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;

  const mkPage = async (managed, ga) => {
    const ctx = await browser.newContext();
    // pretend gtag loads (never hit the real network)
    await ctx.route('**/googletagmanager.com/**', r => r.fulfill({ contentType:'application/javascript', body: '/* gtag stub */' }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType:'application/javascript', body: managed ? (ga ? MANAGED_GA : MANAGED) : 'window.MANAGED=null;' }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  const writesTo = (page, coll) => page.evaluate((c) => (window.__writes||[]).filter(w => w.path.startsWith(c)), coll);

  // ---------- managed mode: app_open tracked to cohorts/{uid} ----------
  const A = await mkPage(true);
  await A.waitForTimeout(400);
  let w = await writesTo(A, 'cohorts/u-metrics');
  check('v39: app_open writes to cohorts/{uid}', w.length >= 1);
  check('v39: write records lastSeen + an opens counter',
    w.some(x => x.data.lastSeen && x.data.opens && x.data.opens.__inc === 1));
  check('v39: write carries no task/idea content',
    !JSON.stringify(w).match(/text|title|note|amount|raw/i));

  // ---------- an AI call increments aiCalls (via a mocked proxy path) ----------
  const preAi = (await writesTo(A, 'cohorts/u-metrics')).length;
  await A.evaluate(async () => {
    // force an ai_call track directly (proxy fetch is not stubbed here)
    track('ai_call');
  });
  await A.waitForTimeout(200);
  w = await writesTo(A, 'cohorts/u-metrics');
  check('v39: ai_call increments aiCalls', w.some(x => x.data.aiCalls && x.data.aiCalls.__inc === 1));

  // ---------- feature_used with a whitelisted feature ----------
  await A.evaluate(() => track('feature_used', {feature: 'break_down'}));
  await A.waitForTimeout(200);
  w = await writesTo(A, 'cohorts/u-metrics');
  check('v39: feature_used tallies per-feature counter',
    w.some(x => x.data.feat_break_down && x.data.feat_break_down.__inc === 1) &&
    w.some(x => x.data.featureUses));

  // ---------- rejects junk feature names (no injection of arbitrary fields) ----------
  await A.evaluate(() => track('feature_used', {feature: 'DROP TABLE; weird'}));
  await A.waitForTimeout(200);
  w = await writesTo(A, 'cohorts/u-metrics');
  check('v39: non-whitelisted feature name is ignored',
    !w.some(x => Object.keys(x.data).some(k => k.startsWith('feat_DROP') || k.includes('weird'))));

  // ---------- space_created carries only the low-cardinality type ----------
  await A.evaluate(() => track('space_created', {type: 'coparenting'}));
  await A.waitForTimeout(200);
  w = await writesTo(A, 'cohorts/u-metrics');
  check('v39: space_created tallies sp_<type>',
    w.some(x => x.data.sp_coparenting && x.data.spacesCreated));

  // ---------- self-hosted / no managed backend: track() is a no-op ----------
  const B = await mkPage(false);
  await B.waitForTimeout(300);
  const bwrites = await B.evaluate(() => (window.__writes||[]).length);
  await B.evaluate(() => track('feature_used', {feature: 'focus_mode'}));
  await B.waitForTimeout(200);
  check('v39: no managed backend → track writes nothing',
    (await B.evaluate(() => (window.__writes||[]).length)) === bwrites);

  // ---------- GA4: opt-in gated ----------
  const G = await mkPage(true, true);   // managed + gaId configured
  await G.waitForTimeout(300);
  check('v39: GA does NOT load without consent',
    await G.evaluate(() => !window.gtag && !gaReady));
  check('v39: analytics settings block is shown when gaId is set',
    await G.evaluate(() => { showView('settings'); return document.getElementById('analyticsBlock').style.display !== 'none'; }));
  // opt in
  await G.evaluate(() => { store.set('analyticsConsent', true); initGA(); track('feature_used', {feature:'focus_mode'}); });
  await G.waitForTimeout(200);
  check('v39: after consent, gtag initialised', await G.evaluate(() => !!window.gtag && gaReady));
  const gaEvents = await G.evaluate(() => (window.dataLayer||[]).filter(a => a[0]==='event').map(a => ({name:a[1], p:a[2]})));
  check('v39: GA received the feature_used event', gaEvents.some(e => e.name === 'feature_used' && e.p.feature === 'focus_mode'));
  const gaConfig = await G.evaluate(() => (window.dataLayer||[]).filter(a => a[0]==='config'));
  check('v39: GA config anonymizes IP + disables ad signals',
    gaConfig.some(a => a[2] && a[2].anonymize_ip === true && a[2].allow_ad_personalization_signals === false));
  const gaPayloads = await G.evaluate(() => JSON.stringify(window.dataLayer||[]));
  check('v39: GA payloads carry no task content', !/plumber|milk|swap pickup/i.test(gaPayloads));

  // consent OFF again → no further GA events
  const before = (await G.evaluate(() => (window.dataLayer||[]).length));
  await G.evaluate(() => { store.set('analyticsConsent', false); track('feature_used', {feature:'expense'}); });
  await G.waitForTimeout(150);
  check('v39: revoking consent stops GA events',
    (await G.evaluate(() => (window.dataLayer||[]).filter(a=>a[0]==='event' && a[2] && a[2].feature==='expense').length)) === 0);

  // GA never loads when the operator set no gaId
  const H = await mkPage(true, false);
  await H.evaluate(() => { store.set('analyticsConsent', true); track('app_open'); });
  await H.waitForTimeout(150);
  check('v39: no gaId → GA stays off even with consent',
    await H.evaluate(() => !window.gtag) &&
    await H.evaluate(() => document.getElementById('analyticsBlock').style.display === 'none'));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
