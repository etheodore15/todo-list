// v100: filter removal & reset. "Easy wins" could be applied and then feel
// un-removable: the chip that clears it rendered LAST in a horizontally
// scrolling bar (off-screen in a tag-heavy space), the ADHD toolkit button
// showed no on/off state, and when filters hid every task the empty state
// claimed "Nothing on the list yet". Now: active filter chips render first
// with a × affordance, the toolkit button shows live state, stacked filters
// get a one-tap "clear filters" chip, and a filtered-empty Today says what's
// hidden and hands over the exit.
const { chromium } = require('playwright');

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
export function initializeFirestore(app){ return {app}; }
export function persistentLocalCache(){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(){ } export async function deleteDoc(){ }
export async function getDoc(){ return {exists: () => false, data: () => null}; }
export function onSnapshot(col, cb){ cb({docChanges: () => []}); return () => {}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n + (c ? '' : ' — ' + (extra || ''))); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    await p.click('nav.tabs button[data-view="today"]');
    await p.waitForTimeout(300);
    return p;
  };

  const SPACE_INIT = () => {
    const t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('cohorts', JSON.stringify(['adhd']));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-fam', name: 'Home', type: 'family', cfg: {apiKey: 'k', projectId: 'p'}}]));
    // a tag-heavy space: enough tag chips that a last-place easy chip scrolls off a phone
    localStorage.setItem('todos', JSON.stringify([
      {id: 'a', text: 'Water the plants', priority: 'low', tags: ['garden'], done: false, date: t, energy: 'low', space: 'hh-fam'},
      {id: 'b', text: 'Do the tax return', priority: 'high', tags: ['admin', 'money'], done: false, date: t, energy: 'high', space: 'hh-fam'},
      {id: 'c', text: 'Book the dentist', priority: 'medium', tags: ['health', 'calls'], done: false, date: t, energy: 'medium', space: 'hh-fam'},
      {id: 'd', text: 'Wash the car', priority: 'low', tags: ['chores', 'weekend'], done: false, date: t, energy: 'high', space: 'hh-fam'}]));
  };

  // ---------- 1. the applied filter is removable from where the finger is ----------
  const A = await mk(SPACE_INIT);
  await A.evaluate(() => { activeSpace = 'hh-fam'; renderTodos(); });
  await A.waitForTimeout(200);
  check('inactive easy chip sits at the end of the bar (unchanged)', await A.evaluate(() => {
    const chips = [...document.querySelectorAll('#tagFilter .fchip')];
    return chips[chips.length - 1].classList.contains('easy');
  }));
  // apply from the ADHD toolkit — the reported path
  await A.locator('.adhd-strip-row .btn', { hasText: 'Easy wins' }).click();
  await A.waitForTimeout(200);
  check('toolkit button now shows the filter is ON',
    /Easy wins · on/.test(await A.locator('.adhd-strip-row').textContent()),
    await A.locator('.adhd-strip-row').textContent());
  check('the ACTIVE easy chip moves to the FRONT of the bar', await A.evaluate(() => {
    const first = document.querySelector('#tagFilter .fchip');
    return first.classList.contains('easy') && first.classList.contains('active');
  }));
  check('the active chip advertises removal (×, aria-pressed, title)', await A.evaluate(() => {
    const b = document.querySelector('#tagFilter .fchip.easy');
    return /×/.test(b.textContent) && b.getAttribute('aria-pressed') === 'true' && /remove/i.test(b.title);
  }));
  await A.locator('#tagFilter .fchip.easy').click();
  await A.waitForTimeout(200);
  check('tapping the chip removes the filter', await A.evaluate(() =>
    easyOnly === false && document.querySelectorAll('#todoList li, #todoList .task, #todoList [class*=task]').length >= 0 &&
    !document.querySelector('#tagFilter .fchip.easy').classList.contains('active')));
  check('toolkit button reads plain again', !/· on/.test(await A.locator('.adhd-strip-row').textContent()));
  // toolkit button toggles OFF too
  await A.locator('.adhd-strip-row .btn', { hasText: 'Easy wins' }).click();
  await A.waitForTimeout(150);
  await A.locator('.adhd-strip-row .btn', { hasText: 'Easy wins' }).click();
  await A.waitForTimeout(150);
  check('the toolkit button itself toggles the filter off again', await A.evaluate(() => easyOnly === false));

  // ---------- 2. stacked filters → one-tap reset ----------
  await A.evaluate(() => { activeTag = 'garden'; easyOnly = true; renderTodos(); });
  await A.waitForTimeout(200);
  check('two filters stacked → a "clear filters" chip appears first', await A.evaluate(() => {
    const first = document.querySelector('#tagFilter .fchip');
    return first && first.classList.contains('clear-filters');
  }));
  await A.locator('#tagFilter .fchip.clear-filters').click();
  await A.waitForTimeout(200);
  check('one tap resets BOTH filters', await A.evaluate(() => easyOnly === false && activeTag === null));
  check('and says so', /Filters cleared/.test(await A.locator('#toast').textContent()));
  check('the clear chip is gone once nothing is stacked',
    await A.locator('#tagFilter .fchip.clear-filters').count() === 0);
  await A.evaluate(() => { easyOnly = true; renderTodos(); });
  await A.waitForTimeout(150);
  check('a single filter shows no clear chip (its own chip clears it)',
    await A.locator('#tagFilter .fchip.clear-filters').count() === 0);
  await A.evaluate(() => { easyOnly = false; renderTodos(); });

  // ---------- 3. filters hiding EVERYTHING → honest empty state with the exit ----------
  const B = await mk(() => {
    const t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('todos', JSON.stringify([
      {id: 'x', text: 'Do the tax return', priority: 'high', tags: ['admin'], done: false, date: t, energy: 'high'},
      {id: 'y', text: 'Call the plumber', priority: 'medium', tags: ['calls'], done: false, date: t, energy: 'medium'}]));
  });
  await B.evaluate(() => { easyOnly = true; renderTodos(); });   // no low-energy tasks exist
  await B.waitForTimeout(200);
  const emptyText = await B.locator('#todoList .empty').textContent();
  check('filtered-empty state names the cause and the count',
    /2 open tasks are hidden by your filter/.test(emptyText) && /easy wins/.test(emptyText), emptyText.slice(0, 120));
  check('…and never claims "Nothing on the list yet"', !/Nothing on the list yet/.test(emptyText));
  await B.click('#emptyClearFilters');
  await B.waitForTimeout(200);
  check('the empty-state button clears the filters and the tasks return', await B.evaluate(() =>
    easyOnly === false && /tax return/.test(document.getElementById('todoList').textContent)));
  // genuinely empty stays genuinely worded
  await B.evaluate(() => { todos = []; saveTodos(); renderTodos(); });
  await B.waitForTimeout(150);
  check('a truly empty Today keeps the original message',
    /Nothing on the list yet/.test(await B.locator('#todoList .empty').textContent()));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
