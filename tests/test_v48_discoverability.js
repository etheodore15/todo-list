// v48: discoverability + a11y wins from the flow audit —
//  (1) a visible ⋯ menu on every task row opens edit/when/repeat/break-down/expense;
//  (2) a 0-task capture routes to Ideas (transcript not "lost") instead of Today;
//  (3) "break it down" never dead-ends offline (starter scaffold for single tasks);
//  (4) inline "added by" for shared-space tasks someone else created;
//  (5) quick-add always confirms, and warns when a filter would hide the task.
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

  const mk = async (seed) => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    if (seed) await page.addInitScript(seed);
    else await page.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  // ---------- 1. visible ⋯ menu opens the per-task actions ----------
  const A = await mk();
  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'plan the birthday party');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(150);
  const row = A.locator('.todo', { hasText: 'birthday party' });
  check('v48: every task row has a visible ⋯ options button', await row.locator('.row-menu').isVisible());
  await row.locator('.row-menu').click();
  await A.waitForTimeout(120);
  const acts = await row.locator('.tacts .tact').allTextContents();
  check('v48: ⋯ reveals Edit / When / Repeat / Break down / Expense',
    acts.some(t=>/Edit/.test(t)) && acts.some(t=>/When/.test(t)) && acts.some(t=>/Repeat/.test(t)) &&
    acts.some(t=>/Break down/.test(t)) && acts.some(t=>/Expense/.test(t)));
  // tapping ⋯ again closes it
  await row.locator('.row-menu').click();
  await A.waitForTimeout(100);
  check('v48: ⋯ toggles the panel closed', !(await row.locator('.transcript').count()));

  // ---------- 2. 0-task capture goes to Ideas, not Today ----------
  const B = await mk();
  await B.click('nav.tabs button[data-view="capture"]');
  await B.fill('#liveText', 'Mum seemed tired today and the weather was grey');   // observation, no action
  await B.click('#saveIdeaBtn');
  await B.waitForTimeout(400);
  check('v48: a 0-task capture lands on the Ideas view (transcript visible), not Today',
    await B.locator('#view-ideas.active').count() === 1);
  check('v48: the saved note appears in Ideas',
    /weather was grey/.test(await B.locator('#ideasList').textContent()));

  // ---------- 3. break-down never dead-ends offline ----------
  const C = await mk();
  const steps = await C.evaluate(() => localBreakdown('do my taxes'));   // single, non-compound, no AI
  check('v48: break-down of a single task returns a usable starter scaffold (not null)',
    Array.isArray(steps) && steps.length >= 3);
  check('v48: the scaffold leads with a trivially-small first step',
    /get out|2-minute|just begin|first small/i.test((steps || []).join(' ')));
  // a compound task still splits on its connectors
  const compound = await C.evaluate(() => localBreakdown('wash the dishes and take out the bins and feed the cat'));
  check('v48: a compound task still splits into its parts', compound.length === 3);

  // ---------- 4. inline "added by" for shared tasks others created ----------
  const D = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
    localStorage.setItem('todos', JSON.stringify([
      {id:'t1', text:'take out the bins', priority:'medium', tags:['home'], done:false,
       date: new Date().toISOString().slice(0,10), space:'hh-fam', createdBy:'Emile', createdAt: Date.now()-3600000}]));
  });
  await D.click('nav.tabs button[data-view="today"]');
  await D.waitForTimeout(200);
  check('v48: a shared task someone else added shows an inline "added by" line',
    /Emile/.test(await D.locator('.todo', { hasText: 'take out the bins' }).textContent()));

  // ---------- 5. quick-add confirms + warns under a filter ----------
  const E = await mk();
  await E.click('nav.tabs button[data-view="today"]');
  // seed a 'work'-tagged task so the work filter actually sticks
  await E.fill('#quickAdd', 'finish the quarterly report'); await E.click('#quickAddBtn'); await E.waitForTimeout(120);
  await E.fill('#quickAdd', 'fix the leaky tap'); await E.click('#quickAddBtn'); await E.waitForTimeout(120);
  // activate the work tag filter, then add a non-matching (home) task
  await E.evaluate(() => { activeTag = 'work'; renderTodos(); });
  check('v48: precondition — work filter is active', await E.evaluate(() => activeTag === 'work'));
  await E.fill('#quickAdd', 'water the plants');   // 'home', not 'work'
  await E.click('#quickAddBtn');
  await E.waitForTimeout(150);
  check('v48: quick-add warns when a filter hides the just-added task',
    /hidden by the .work. filter|tap .All./i.test(await E.locator('#toast').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
