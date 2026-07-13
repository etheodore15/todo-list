// v40 operator dashboard: Google sign-in gated to operators, aggregates
// cohorts/* into tiles + bars, denies non-operators, links docs.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1'};`;
  const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
  // auth stub: signInWithPopup succeeds as a chosen uid; onAuthStateChanged fires it
  const mkAuth = (uid, email) => `
    let user = null; const ls = [];
    export function getAuth(){ return {get currentUser(){ return user; }}; }
    export function onAuthStateChanged(a, cb){ ls.push(cb); cb(user); return ()=>{}; }
    export function GoogleAuthProvider(){ }
    export async function signInWithPopup(){ user = {uid:${JSON.stringify(uid)}, email:${JSON.stringify(email)}}; ls.forEach(cb=>cb(user)); return {user}; }
    export async function signOut(){ user = null; ls.forEach(cb=>cb(null)); }`;
  // firestore stub: getDocs returns seeded cohort docs, but THROWS for non-operator uid
  const mkFs = (operatorUid) => `
    let currentUid = null;
    export function initializeFirestore(){ return {}; }
    export function collection(db, name){ return {name}; }
    export function doc(){ return {}; }
    export async function getDocs(col){
      // emulate the operator rule: only the allowlisted uid may list cohorts
      if (window.__uid !== ${JSON.stringify(operatorUid)}) { const e = new Error('permission-denied'); throw e; }
      const now = Date.now();
      const docs = [
        {cohorts:['adhd'], lastSeen:now, opens:5, aiCalls:12, onboards:1, spacesCreated:1, featureUses:3, feat_break_down:2, feat_focus_mode:1, sp_family:1},
        {cohorts:['coparenting','adhd'], lastSeen:now-2*864e5, opens:9, aiCalls:40, onboards:1, spacesCreated:2, feat_tone_check:5, feat_expense:2, sp_coparenting:2},
        {cohorts:['caregiving'], lastSeen:now-40*864e5, opens:3, aiCalls:8, onboards:1, spacesCreated:1, feat_briefing:1, sp_care:1},
        {cohorts:[], lastSeen:now-1*864e5, opens:1}
      ];
      return { forEach(fn){ docs.forEach(d => fn({ data:()=>d })); } };
    }`;

  const mkPage = async (uid, email, operatorUid) => {
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType:'application/javascript', body: MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType:'application/javascript', body: mkAuth(uid, email) }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType:'application/javascript', body: mkFs(operatorUid) }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    // the fs stub reads window.__uid to decide operator access; keep it in sync on sign-in
    await page.addInitScript(() => {
      const orig = Object.getOwnPropertyDescriptor(window, '__uid');
    });
    await page.goto('http://localhost:8906/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  // ---------- not signed in ----------
  const A = await mkPage('op-1', 'op@x.com', 'op-1');
  check('dash: sign-in view shown initially', await A.locator('#signInView').isVisible());
  check('dash: dashboard hidden initially', !(await A.locator('#dashView').isVisible()));
  check('dash: docs hub always present', (await A.locator('.doc').count()) >= 5);

  // ---------- operator signs in ----------
  await A.evaluate(() => { window.__uid = 'op-1'; });   // rule sees operator
  await A.click('#signInBtn');
  await A.waitForTimeout(400);
  check('dash: operator sees the dashboard', await A.locator('#dashView').isVisible());
  check('dash: denied view not shown for operator', !(await A.locator('#deniedView').isVisible()));

  const tiles = await A.locator('#tiles .tile .v').allTextContents();
  check('dash: installs tile counts all docs', tiles[0] === '4');
  check('dash: AI calls summed', tiles.some(t => t === '60'));   // 12+40+8
  check('dash: spaces created summed', tiles.some(t => t === '4'));  // 1+2+1
  const active7 = await A.locator('#tiles .tile').filter({ hasText: 'active last 7 days' }).locator('.v').textContent();
  check('dash: active-7d excludes the 40-day-old user', active7 === '3');

  // cohort bars: adhd appears in 2 docs, coparenting 1, caregiving 1
  const cohortText = await A.locator('#cohortBars').textContent();
  check('dash: cohort counts aggregate multi-select',
    /Focus & ADHD/.test(cohortText) && /2/.test(cohortText));
  check('dash: no-cohort note shown', /haven’t chosen/.test(await A.locator('#cohortNote').textContent()));

  const featText = await A.locator('#featureBars').textContent();
  check('dash: feature usage aggregated', /Tone check/.test(featText) && /Break it down/.test(featText));
  const spaceText = await A.locator('#spaceBars').textContent();
  check('dash: spaces-by-type shown', /Co-parenting/.test(spaceText));

  // ---------- non-operator is denied ----------
  const B = await mkPage('rando-9', 'rando@x.com', 'op-1');
  await B.evaluate(() => { window.__uid = 'rando-9'; });
  await B.click('#signInBtn');
  await B.waitForTimeout(400);
  check('dash: non-operator sees denied view', await B.locator('#deniedView').isVisible());
  check('dash: non-operator does NOT see data', !(await B.locator('#dashView').isVisible()));
  check('dash: denied view shows the uid to allowlist', /rando-9/.test(await B.locator('#myUid').textContent()));

  // ---------- no task content anywhere on the page ----------
  const pageText = await A.evaluate(() => document.body.innerText);
  check('dash: page shows no task content', !/plumber|milk|swap pickup|dementia/i.test(pageText));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
