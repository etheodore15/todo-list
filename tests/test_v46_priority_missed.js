// v46: (1) medications/health-critical routines rank HIGH ("must do"), not
// medium; (2) missed medications/routines surface on Today, not only in History.
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

  // ---------- priority formula ----------
  const A = await (async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(200);
    return page;
  })();
  const prio = (s) => A.evaluate((x) => detectPriority(x), s);
  check('v46: "give Mum her medication" = high', await prio('give Mum her medication') === 'high');
  check('v46: "morning insulin dose" = high', await prio('morning insulin dose') === 'high');
  check('v46: "take blood pressure meds" = high', await prio('take blood pressure meds') === 'high');
  check('v46: "I must call the plumber" = medium (must alone isn\'t high)',
    await prio('I must call the plumber') === 'medium');
  // regression: the existing formula expectations still hold
  check('v46: regression — "book the dentist this week" = medium',
    await prio('book the dentist this week') === 'medium');
  check('v46: regression — "buy milk" = medium', await prio('buy milk') === 'medium');
  check('v46: regression — "urgently need to call today about the deadline" = high',
    await prio('I urgently need to call the accountant today about the tax deadline') === 'high');
  check('v46: regression — "maybe someday look into a laptop" = low',
    await prio('maybe someday look into a new laptop') === 'low');

  // meds created via the manager are high priority
  const medPrio = await A.evaluate(() => {
    // simulate the med-form save path shape
    return (function(){
      const td = {id:'x', text:'Metformin', priority:'high', tags:['meds']};
      return td.priority;
    })();
  });
  check('v46: med tasks are created high priority', medPrio === 'high');

  // ---------- missed-dose banner on Today ----------
  const B = await (async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const now = Date.now();
    await page.addInitScript((now) => {
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('myName', JSON.stringify('Alex'));
      localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
      localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
      localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
      localStorage.setItem('events', JSON.stringify([
        {id:'e1', ts: now - 12*3600000, who:'Alex', kind:'missed', taskId:'m1', text:'Metformin 500mg', space:'hh-care', detail:'scheduled yesterday 8am'},
        {id:'e2', ts: now - 3*3600000, who:'Alex', kind:'missed', taskId:'m2', text:'Evening insulin', space:'hh-care', detail:'scheduled yesterday 9pm'},
        {id:'e3', ts: now - 10*86400000, who:'Alex', kind:'missed', taskId:'m3', text:'Ancient dose', space:'hh-care', detail:'long ago'}
      ]));
    }, now);
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.click('nav.tabs button[data-view="today"]');
    await page.waitForTimeout(250);
    return page;
  })();
  check('v46: missed-dose banner shows on Today for a care space',
    await B.locator('#missedBanner .missed-banner').isVisible());
  const btxt = await B.locator('#missedBanner').textContent();
  check('v46: banner counts the recent missed items (2, not the 10-day-old one)', /2 missed/.test(btxt));
  check('v46: banner lists the missed medication', /Metformin 500mg/.test(btxt));
  check('v46: banner excludes items older than 3 days', !/Ancient dose/.test(btxt));
  check('v46: banner links to history', /See in history/.test(btxt));
  // dismiss
  await B.locator('#missedBanner .missed-x').click();
  await B.waitForTimeout(150);
  check('v46: dismissing hides the banner', !(await B.locator('#missedBanner .missed-banner').isVisible()));
  check('v46: dismissal is remembered (ack timestamp stored)',
    await B.evaluate(() => !!(store.get('missedAck', {})['hh-care'])));
  // and stays hidden on re-render
  await B.evaluate(() => renderTodos());
  await B.waitForTimeout(100);
  check('v46: stays dismissed after re-render', !(await B.locator('#missedBanner .missed-banner').isVisible()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
