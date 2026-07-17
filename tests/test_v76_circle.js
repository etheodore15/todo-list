// v76: build flavors + Cooee circle pack Phase 1a/1b.
// - window.FLAVOR (stamped per deploy) renames/re-themes the product and
//   filters which cohorts are offered. No FLAVOR = ideatodo, unchanged.
// - New cohort 'ndis-circle' + space type 'circle', behind the 'circle'
//   feature flag (hidden by default; on in the cooee flavor).
// - Circle guided setup starts with "Who is this circle for?" — the
//   participant owns the record; a substitute decision-maker is recorded as
//   acting on their behalf (never silently owning it).
// - Circle spaces are managed-only (roles need Auth UIDs — COOEE-MAPPING §3.4).
const { chromium } = require('playwright');

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
export function initializeFirestore(app){ return {app}; }
export function persistentLocalCache(){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(){ }
export async function deleteDoc(){ }
export async function getDoc(){ return {exists: () => false, data: () => null}; }
export function onSnapshot(col, cb){ cb({docChanges: () => []}); return () => {}; }`;
const COOEE_CFG = `window.MANAGED = null;
window.FLAVOR = {id:'cooee', name:'Cooee', cohorts:['ndis-circle','adhd'],
  flags:{circle:true}, theme:{accent:'#0f7b6c'}};`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (cfgBody, init) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfgBody }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    if (init) await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- 1. the cooee flavor: branding, theme, cohort filtering ----------
  const A = await mk(COOEE_CFG);   // fresh user → onboarding
  check('v76: flavor renames the product', await A.title() === 'Cooee' &&
    /Cooee/.test(await A.locator('#hdrTitle').textContent()));
  check('v76: flavor theme applied', await A.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent') === '#0f7b6c'));
  check('v76: only the flavor’s cohorts are offered',
    await A.locator('#obChips .ob-chip').count() === 2);
  const chips = await A.locator('#obChips').textContent();
  check('v76: circle cohort present with participant-first copy',
    /Coordinating my own supports/.test(chips) && /Focus & follow-through/.test(chips));
  await A.locator('.ob-chip', { hasText: 'Coordinating my own supports' }).click();
  await A.click('#obContinue');
  await A.waitForTimeout(200);
  check('v76: circle toolkit explains About Me + record ownership',
    /About Me/.test(await A.locator('#obToolkit').textContent()) &&
    /owned by you/i.test(await A.locator('#obToolkit').textContent()));
  await A.click('#obStart');
  await A.waitForTimeout(200);
  check('v76: step 3 offers creating a Circle',
    /Create a circle/i.test(await A.locator('#obSpaceChoices').textContent()));
  // managed backend is null here → circle creation must refuse, politely
  await A.locator('.ob-space', { hasText: 'circle' }).click();
  await A.waitForTimeout(300);
  check('v76: circle spaces are managed-only (self-hosted refused)',
    /hosted service/.test(await A.locator('#toast').textContent()));

  // ---------- 2. the default (ideatodo) build: circle hidden unless flagged ----------
  const B = await mk('window.MANAGED=null;');
  check('v76: no FLAVOR → default four cohorts, no circle',
    await B.locator('#obChips .ob-chip').count() === 4 &&
    !/Coordinating my own supports/.test(await B.locator('#obChips').textContent()));
  const C = await mk('window.MANAGED=null;', () => localStorage.setItem('flag:circle', 'true'));
  check('v76: local dev flag surfaces the circle cohort in the default build',
    await C.locator('#obChips .ob-chip').count() === 5);
  check('v76: default build branding untouched', await C.title() !== 'Cooee');

  // ---------- 3. circle space: action bar, setup, ownership declaration ----------
  const D = await mk(COOEE_CFG, () => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Emile'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-cir', name:'My Circle', type:'circle', cfg:{apiKey:'k',projectId:'p'}}]));
  });
  // v79: circle action bars are built per-render (role/session aware)
  const circActs = await D.evaluate(() => SPACE_ACTIONS.circle(spacesList()[0]).map(a => a[1]));
  check('v76: circle action bar — About Me / meds / note / history / invite',
    circActs.includes('About Me') && circActs.includes('Routines & meds') &&
    circActs.includes('History & export') && circActs.includes('Invite'));
  await D.evaluate(() => guideSpaceSetup(spacesList()[0]));
  await D.waitForTimeout(300);
  const steps = await D.locator('#setupSteps').textContent();
  check('v76: circle setup starts with ownership, then About Me + routines',
    /^.*Who is this circle for\?/.test(steps) && /About Me/.test(steps) && /routines & medications/i.test(steps));
  await D.locator('.setup-step', { hasText: 'Who is this circle for?' }).click();
  await D.waitForTimeout(200);
  check('v76: ownership sheet opens with plain-language framing',
    await D.locator('#circleOwnerSheet').isVisible() &&
    /acting on their behalf/.test(await D.locator('#circleOwnerSheet').textContent()));
  // the decision-maker path: participant named, nominee recorded
  await D.click('#circleForOther');
  await D.waitForTimeout(200);
  await D.fill('#inputField', 'Blaire');
  await D.click('#inputSave');
  await D.waitForTimeout(300);
  const owner = await D.evaluate(() => JSON.parse(localStorage.getItem('spaces'))[0].circle);
  check('v76: participant owns the record', owner && owner.participant === 'Blaire' && owner.mode === 'nominee');
  check('v76: the decision-maker is recorded as acting, not owning', owner.nominee === 'Emile');
  check('v76: the declaration is in the append-only record', await D.evaluate(() =>
    JSON.parse(localStorage.getItem('events') || '[]').some(e =>
      e.kind === 'circle-owner' && /Blaire owns this record/.test(e.text) && /decision-maker/.test(e.text))));
  check('v76: setup step marked done', await D.evaluate(() =>
    document.querySelector('.setup-step').classList.contains('done')));

  // circle journal: capture offers "Save to journal" for the circle space
  await D.evaluate(() => { document.getElementById('setupSheet').style.display = 'none'; });
  await D.click('nav.tabs button[data-view="capture"]');
  await D.waitForTimeout(200);
  check('v76: capture offers the circle journal',
    await D.locator('#saveNoteBtn').isVisible() &&
    /My Circle journal/.test(await D.locator('#saveNoteBtn').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
