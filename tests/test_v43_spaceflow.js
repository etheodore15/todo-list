// v43: space-aware flow. Choosing a cohort / creating a space must actually
// change what the user sees — a guided-create that opens (not toggles shut) the
// form with the right type, a post-create setup checklist, a Today action bar +
// header that reflect the space type, a discoverable custody placeholder, and a
// persistent ADHD toolkit strip.
const { chromium } = require('playwright');

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
export function initializeFirestore(app, opts){ return {app}; }
export function persistentLocalCache(o){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(){ }
export async function deleteDoc(){ }
export async function getDoc(ref){ return {exists: () => false, data: () => null}; }
export function onSnapshot(col, cb){ cb({docChanges: () => []}); return () => {}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  // seed: seedSpaces (array) + cohorts (array) + onboarded flag. When null, a
  // genuinely fresh install (for the onboarding-action test).
  const mkPage = async ({ spaces, cohorts, onboarded = true } = {}) => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript((s) => {
      if (s.onboarded) localStorage.setItem('onboarded', 'true');
      if (s.spaces){
        localStorage.setItem('myName', JSON.stringify('alex'));
        localStorage.setItem('spaces', JSON.stringify(s.spaces));
        localStorage.setItem('fbConfig', JSON.stringify({apiKey: 'k', projectId: 'p'}));
      }
      if (s.cohorts) localStorage.setItem('cohorts', JSON.stringify(s.cohorts));
    }, { spaces, cohorts, onboarded });
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return page;
  };

  const gotoToday = async (p) => { await p.click('nav.tabs button[data-view="today"]'); await p.waitForTimeout(200); };

  // ---------- 1. guided create OPENS the form with the right type ----------
  // Fresh install → onboarding. Pick co-parenting, continue, tap the create
  // action, and assert the create form is visible with type = coparenting
  // (the old code toggled the already-open form SHUT and left type = family).
  const A = await mkPage({ onboarded: false });
  check('v43: onboarding shows on a fresh install', await A.locator('#onboarding').isVisible());
  await A.locator('#obChips .ob-chip', { hasText: 'Co-parenting' }).click();
  await A.click('#obContinue');
  await A.locator('#obToolkit button', { hasText: 'Create a co-parenting space' }).click();
  await A.waitForTimeout(300);
  check('v43: guided create reveals the create form (not toggled shut)',
    await A.locator('#syncSetup').isVisible() && await A.locator('#spaceNameInput').isVisible());
  check('v43: guided create pre-selects the co-parenting type',
    (await A.locator('#spaceTypeSel').inputValue()) === 'coparenting');
  check('v43: guided create expands the create details',
    await A.evaluate(() => document.querySelector('#syncSetup details').open === true));

  // ---------- 2. post-create setup checklist (call the helper directly) ----------
  const B = await mkPage({ spaces: [] });
  const careSteps = await B.evaluate(() => {
    guideSpaceSetup({ hid: 'hh-care', name: 'Mum', type: 'care', cfg: {apiKey:'k',projectId:'p'} });
    return [...document.querySelectorAll('#setupSteps .setup-step b')].map(b => b.textContent);
  });
  check('v43: care setup sheet is shown', await B.locator('#setupSheet').isVisible());
  check('v43: care setup prompts the profile', careSteps.some(s => /profile/i.test(s)));
  check('v43: care setup prompts a first medication/routine', careSteps.some(s => /medication|routine/i.test(s)));
  check('v43: care setup prompts an invite', careSteps.some(s => /invite/i.test(s)));
  const copSteps = await B.evaluate(() => {
    guideSpaceSetup({ hid: 'hh-cop', name: 'Kids', type: 'coparenting', cfg: {apiKey:'k',projectId:'p'} });
    return [...document.querySelectorAll('#setupSteps .setup-step b')].map(b => b.textContent);
  });
  check('v43: co-parenting setup prompts custody days', copSteps.some(s => /custody/i.test(s)));

  // ---------- 3. Today action bar + header reflect the space type ----------
  const C = await mkPage({ spaces: [{hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}] });
  await gotoToday(C);
  check('v43: header reflects the active co-parenting space',
    /Kids/.test(await C.locator('#hdrTitle').textContent()));
  check('v43: Today shows a space action bar', await C.locator('#spaceBar .space-bar').isVisible());
  const copActs = await C.locator('#spaceBar .space-act').allTextContents();
  check('v43: co-parenting bar surfaces Custody, Ledger, History',
    copActs.some(t => /Custody/.test(t)) && copActs.some(t => /Ledger/.test(t)) && copActs.some(t => /History/.test(t)));

  const D = await mkPage({ spaces: [{hid:'hh-care', name:'Mum', type:'care', cfg:{apiKey:'k',projectId:'p'}}] });
  await gotoToday(D);
  const careActs = await D.locator('#spaceBar .space-act').allTextContents();
  check('v43: care bar surfaces Profile + History & briefing',
    careActs.some(t => /Profile/.test(t)) && careActs.some(t => /briefing/i.test(t)));

  // ---------- 4. custody placeholder is discoverable before it's configured ----------
  check('v43: unconfigured co-parenting space shows a “set custody days” prompt on Today',
    await C.locator('#custodyBanner .custody-set').isVisible());

  // ---------- 5. ADHD toolkit strip: persistent + dismissible ----------
  const E = await mkPage({ cohorts: ['adhd'] });
  await gotoToday(E);
  check('v43: ADHD toolkit strip shows for the adhd cohort', await E.locator('#adhdStrip .adhd-strip').isVisible());
  const tools = await E.locator('#adhdStrip .space-act').allTextContents();
  check('v43: ADHD strip has live feature buttons (Just one thing, Break down, Easy wins, Quiet)',
    tools.some(t => /Just one thing/.test(t)) && tools.some(t => /Break down/.test(t)) &&
    tools.some(t => /Easy wins/.test(t)) && tools.some(t => /Quiet/.test(t)));
  await E.locator('#adhdStrip .adhd-strip-x').click();
  await E.waitForTimeout(150);
  check('v43: ADHD strip can be dismissed', !(await E.locator('#adhdStrip .adhd-strip').isVisible()));
  const F = await mkPage({ cohorts: ['family'] });
  await gotoToday(F);
  check('v43: no ADHD strip for a non-adhd cohort', !(await F.locator('#adhdStrip .adhd-strip').isVisible()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
