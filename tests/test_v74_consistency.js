// v74: naming consistency + checkbox tag picker.
// - The same thing is called the same word everywhere: 'Private' on both the
//   capture destination row and the Today space filter; 'Records summary',
//   'Week report', 'History & export' / 'History & briefing' match between
//   each space's action bar and the Journal's Records rows; the family report
//   is titled 'week report' (matching its button), the care report 'doctor
//   briefing' (matching its button).
// - Tags are edited with a CHECKBOX list (max 3 enforced), not comma-separated
//   text — typing only needed to coin a brand-new tag.
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

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
  await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
  await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    const DAY = 86400000, now = Date.now();
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}]));
    const t = new Date().toISOString().slice(0,10);
    localStorage.setItem('todos', JSON.stringify([
      {id:'t1', text:'Pick up prescription', priority:'medium', tags:['health'], done:false, date:t, createdBy:'Alex'},
      {id:'f1', text:'Take the bins out', priority:'low', tags:[], done:true, date:t, doneAt: now - DAY, space:'hh-fam', doneBy:'Lulu'}]));
    localStorage.setItem('events', JSON.stringify([
      {id:'e1', kind:'note', space:'hh-care', who:'Alex', ts: now - 3600000, text:'Ate well today'}]));
  });
  await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await p.waitForTimeout(400);

  // ---------- 1. one word for the un-shared destination ----------
  const capChips = await p.locator('#destChips').textContent();
  await p.click('nav.tabs button[data-view="today"]');
  await p.waitForTimeout(300);
  const filterChips = await p.locator('#spaceFilter').textContent();
  check('v74: capture row says Private', /Private/.test(capChips));
  check('v74: Today filter says Private too (no more Personal)',
    /Private/.test(filterChips) && !/Personal/.test(filterChips));

  // ---------- 2. bar labels match the Journal records rows, per space type ----------
  const famActs = await p.evaluate(() => SPACE_ACTIONS.family.map(a => a[1]));
  const copActs = await p.evaluate(() => SPACE_ACTIONS.coparenting.map(a => a[1]));
  const careActs = await p.evaluate(() => SPACE_ACTIONS.care.map(a => a[1]));
  check('v74: family + co-parent bars say History & export',
    famActs.includes('History & export') && copActs.includes('History & export'));
  check('v74: care bar keeps History & briefing', careActs.includes('History & briefing'));
  check('v74: co-parent bar names the report like the Journal card does',
    copActs.includes('Records summary'));
  await p.click('nav.tabs button[data-view="ideas"]');
  await p.waitForTimeout(300);
  const recText = await p.locator('#jrnRecords').textContent();
  check('v74: Journal records rows use the same labels',
    /History & briefing/.test(recText) && /History & export/.test(recText));

  // ---------- 3. report titles match their buttons ----------
  await p.evaluate(() => openFamilyReport(spacesList().find(s => s.type === 'family')));
  await p.waitForTimeout(400);
  const fam = await p.locator('#briefBody').textContent();
  check('v74: family report titled "week report" (matches its button)',
    /week report/.test(fam) && !/week in review/.test(fam));
  await p.evaluate(() => { document.getElementById('briefOverlay').style.display='none';
    openBriefing(spacesList().find(s => s.type === 'care')); });
  await p.waitForTimeout(500);
  check('v74: care report titled "doctor briefing" (matches its button)',
    /doctor briefing/.test(await p.locator('#briefBody').textContent()));
  await p.evaluate(() => { document.getElementById('briefOverlay').style.display='none'; });

  // ---------- 4. tag editing is a checkbox list, not text entry ----------
  await p.click('nav.tabs button[data-view="today"]');
  await p.waitForTimeout(300);
  await p.locator('.todo', { hasText: 'Pick up prescription' }).locator('.ttag', { hasText: 'health' }).first().click();
  await p.waitForTimeout(200);
  check('v74: tapping tags opens the checkbox sheet (no typing needed)',
    await p.locator('#tagSheet').isVisible() &&
    await p.locator('#tagChoices input[type="checkbox"]').count() > 10);
  check('v74: the task\'s current tag is pre-ticked', await p.evaluate(() =>
    [...document.querySelectorAll('#tagChoices input')].find(b => b.value === 'health').checked));
  // tick two more from the vocabulary — pure clicking
  await p.locator('#tagChoices label', { hasText: 'errands' }).locator('input').check();
  await p.locator('#tagChoices label', { hasText: 'car' }).locator('input').check();
  check('v74: max 3 enforced — remaining boxes disable at three ticked', await p.evaluate(() =>
    [...document.querySelectorAll('#tagChoices input')].filter(b => !b.checked).every(b => b.disabled)));
  check('v74: hint explains the swap', /untick one to swap/.test(await p.locator('#tagHint').textContent()));
  await p.click('#tagSave');
  await p.waitForTimeout(300);
  check('v74: picked tags land on the task', await p.evaluate(() => {
    const tags = JSON.parse(localStorage.getItem('todos')).find(t => t.id === 't1').tags;
    return tags.length === 3 && tags.includes('health') && tags.includes('errands') && tags.includes('car');
  }));

  // a brand-new tag can still be coined — the one place typing is needed
  await p.locator('.todo', { hasText: 'Pick up prescription' }).locator('.ttag', { hasText: 'health' }).first().click();
  await p.waitForTimeout(200);
  await p.locator('#tagChoices label', { hasText: 'errands' }).locator('input').uncheck();
  await p.fill('#tagNew', 'school run');
  await p.click('#tagAdd');
  check('v74: a new tag appears ticked at the top of the list', await p.evaluate(() => {
    const first = document.querySelector('#tagChoices input');
    return first.value === 'school run' && first.checked;
  }));
  await p.click('#tagSave');
  await p.waitForTimeout(200);
  check('v74: the new tag saves onto the task', await p.evaluate(() =>
    JSON.parse(localStorage.getItem('todos')).find(t => t.id === 't1').tags.includes('school run')));
  // Escape closes the sheet
  await p.locator('.todo', { hasText: 'Pick up prescription' }).locator('.ttag', { hasText: 'health' }).first().click();
  await p.waitForTimeout(200);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  check('v74: Escape closes the tag sheet', !(await p.locator('#tagSheet').isVisible()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
