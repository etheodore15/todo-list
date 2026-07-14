// v44: structured medications & routines for care spaces. The care profile only
// captured WHO the person is; meds/schedule had no discoverable entry (a med was
// a free-text "every day" quick-add). This adds a structured manager reachable
// from the profile, the care space bar, and the setup checklist.
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

  const ctx = await browser.newContext();
  await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
  await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
  await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('cohorts', JSON.stringify(['caregiving']));
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('careProfile', JSON.stringify({'hh-care':{name:'Margaret', age:'82'}}));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
  });
  await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.click('nav.tabs button[data-view="today"]');
  await p.waitForTimeout(200);

  // ---------- entry point 1: care space bar has a Meds button ----------
  const bar = await p.locator('#spaceBar .space-act').allTextContents();
  check('v44: care space bar has a 💊 Meds action', bar.some(t => /Meds/.test(t)));

  // ---------- entry point 2: from the profile sheet ----------
  await p.click('nav.tabs button[data-view="settings"]');
  await p.waitForTimeout(150);
  await p.locator('#spacesList button', { hasText: 'Care profile' }).click();
  check('v44: profile sheet has a Medications & routines button',
    await p.locator('#profileMedsBtn').isVisible());
  await p.click('#profileMedsBtn');
  check('v44: medications manager opens', await p.locator('#medListSheet').isVisible());
  check('v44: empty state shown when no meds yet', /No medications/.test(await p.locator('#medList').textContent()));

  // ---------- add a daily medication with a structured form ----------
  await p.click('#medAddBtn');
  check('v44: med form opens', await p.locator('#medSheet').isVisible());
  await p.fill('#medName', 'Metformin 500mg');
  await p.fill('#medDose', '1 tablet with food');
  await p.fill('#medTime', '08:00');
  check('v44: repeat defaults to daily',
    await p.locator('#medRepeat .med-rep.active').getAttribute('data-rep') === 'daily');
  await p.click('#medSave');
  await p.waitForTimeout(200);
  check('v44: back on the list after save', await p.locator('#medListSheet').isVisible());
  check('v44: new med appears in the list', /Metformin 500mg/.test(await p.locator('#medList').textContent()));
  check('v44: list shows the time + schedule', /8am.*day|8am.*Every|8am/i.test(await p.locator('#medList').textContent()));

  // ---------- the med is a real recurring, timed, tagged task in the space ----------
  const med = await p.evaluate(() => {
    const t = todos.find(x => x.med && x.med.name === 'Metformin 500mg');
    return t && {space: t.space, time: t.time, recurType: t.recur && t.recur.type,
      tag: (t.tags||[]).includes('meds'), dose: t.med.dose, prio: t.priority};
  });
  check('v44: med task is in the care space', med && med.space === 'hh-care');
  check('v44: med task is daily + timed', med && med.recurType === 'daily' && med.time === '08:00');
  check('v44: med task tagged meds + high priority (must-do, renders in Do first)', med && med.tag && med.prio === 'high');
  check('v44: dose captured', med && med.dose === '1 tablet with food');

  // ---------- it shows on Today ----------
  await p.click('#medListClose');
  await p.click('#profileCancel');   // meds was opened from the profile — close that too
  await p.click('nav.tabs button[data-view="today"]');
  await p.waitForTimeout(200);
  check('v44: the medication shows on Today', /Metformin 500mg/.test(await p.locator('#todoList').textContent()));

  // ---------- edit → weekly (chosen days) ----------
  await p.evaluate(() => openMeds(spacesList().find(s => s.hid === 'hh-care')));
  await p.waitForTimeout(150);
  await p.locator('#medList .med-item', { hasText: 'Metformin' }).click();
  await p.click('#medRepeat .med-rep[data-rep="weekly"]');
  check('v44: choosing “Chosen days” reveals the weekday picker',
    await p.locator('#medDays').isVisible());
  await p.locator('#medDays .med-day', { hasText: 'Mon' }).click();
  await p.locator('#medDays .med-day', { hasText: 'Thu' }).click();
  await p.click('#medSave');
  await p.waitForTimeout(200);
  const wk = await p.evaluate(() => {
    const t = todos.find(x => x.med && x.med.name === 'Metformin 500mg');
    return t && t.recur;
  });
  check('v44: edit persisted a weekly Mon/Thu schedule',
    wk && wk.type === 'weekly' && wk.dow.includes(1) && wk.dow.includes(4) && wk.dow.length === 2);

  // ---------- delete ----------
  p.on('dialog', d => d.accept());
  await p.evaluate(() => openMeds(spacesList().find(s => s.hid === 'hh-care')));
  await p.waitForTimeout(150);
  await p.locator('#medList .med-item', { hasText: 'Metformin' }).click();
  await p.click('#medDelete');
  await p.waitForTimeout(200);
  check('v44: delete removes the med task',
    await p.evaluate(() => !todos.some(x => x.med && x.med.name === 'Metformin 500mg')));
  check('v44: list empty again after delete', /No medications/.test(await p.locator('#medList').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
