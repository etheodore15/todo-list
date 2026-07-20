// v95: joiner onboarding (persona study #21) — invite-joiners used to skip
// onboarding entirely. Now a 30-second arrival flow shaped by the joined
// space: what it does, why your name matters, straight into a first capture.
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
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' — ' + (extra || ''))); cond ? pass++ : fail++; };
  const errors = [];
  const mk = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(init || (() => localStorage.setItem('onboarded', 'true')));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };
  // a real self-hosted-style invite code, minted by the app's own encoder
  const joinVia = async (p, hid, name, type) => {
    const code = await p.evaluate(([h, n, t]) => inviteEncode({apiKey: 'k', projectId: 'p'}, h, n, t), [hid, name, type]);
    await p.click('nav.tabs button[data-view="settings"]');
    await p.fill('#inviteInput', code);
    await p.click('#joinBtn');
    await p.waitForTimeout(600);
  };

  // ---------- 1. joining a CARE space: the welcome is care-shaped ----------
  const A = await mk();
  await joinVia(A, 'hh-mum', "Mum's care", 'care');
  check('the joiner welcome appears after joining', await A.locator('#joinerOb').isVisible());
  check('it names the space', /Mum's care/.test(await A.locator('#joTitle').textContent()));
  const careCopy = await A.locator('#joPoints').textContent();
  check('care copy: ticks are records, notes feed the briefing',
    /medication/.test(careCopy) && /doctor briefing/.test(careCopy), careCopy.slice(0, 120));
  check('it asks for the name attribution runs on',
    await A.locator('#joName').isVisible() && /trust model/.test(await A.locator('#joinerOb').textContent()));

  // name + straight into a first capture aimed at the joined space
  await A.fill('#joName', 'Kim');
  await A.click('#joCapture');
  await A.waitForTimeout(300);
  check('“Try your first capture” lands on the capture screen',
    await A.evaluate(() => document.getElementById('view-capture').classList.contains('active')));
  check('…with the joined space as the active destination',
    /Mum's care/.test(await A.locator('#destChips .fchip.active').textContent()));
  check('…and the name saved for attribution', await A.evaluate(() => myName() === 'Kim'));

  // once per space: a re-join just toasts
  await A.evaluate(() => showJoinerOnboarding({hid: 'hh-mum', name: "Mum's care", type: 'care'}));
  await A.waitForTimeout(200);
  check('a second arrival at the same space skips the welcome',
    !(await A.locator('#joinerOb').isVisible()));

  // ---------- 2. co-parenting join: record-shaped copy, Explore path ----------
  const B = await mk(() => { localStorage.setItem('onboarded', 'true'); localStorage.setItem('myName', JSON.stringify('Rob')); });
  await joinVia(B, 'hh-pip', 'Pip', 'coparenting');
  const copCopy = await B.locator('#joPoints').textContent();
  check('co-parenting copy: append-only record + ledger + neutral report',
    /append-only/.test(copCopy) && /ledger/.test(copCopy) && /neutral/.test(copCopy), copCopy.slice(0, 120));
  check('the name field prefills for a named device', await B.inputValue('#joName') === 'Rob');
  await B.click('#joLater');
  await B.waitForTimeout(200);
  check('“Explore first” dismisses without hijacking the view',
    !(await B.locator('#joinerOb').isVisible()));

  // ---------- 3. circle roles get role-true welcomes ----------
  const C = await mk();
  await C.evaluate(() => showJoinerOnboarding({hid: 'hh-c1', name: "Liam's circle", type: 'circle', role: 'worker'}));
  const workerCopy = await C.locator('#joPoints').textContent();
  check('worker copy: sessions, plan-goal notes, private incidents',
    /Start support/.test(workerCopy) && /Plan Review Pack/.test(workerCopy) && /admins/.test(workerCopy), workerCopy.slice(0, 120));
  await C.click('#joLater');
  await C.evaluate(() => showJoinerOnboarding({hid: 'hh-c2', name: "Mia's circle", type: 'circle', role: 'viewer'}));
  const viewerCopy = await C.locator('#joPoints').textContent();
  check('viewer copy: read everything, write nothing, private journal for your own words',
    /read everything/.test(viewerCopy) && /viewer/.test(viewerCopy) && /my Journal/.test(viewerCopy), viewerCopy.slice(0, 140));
  check('the viewer subtitle is honest about the role',
    /as a viewer/.test(await C.locator('#joSub').textContent()));
  await C.click('#joCapture');
  await C.waitForTimeout(300);
  check('a viewer’s first capture lands on Private (no phantom destination)',
    await C.evaluate(() => captureDestVal() === null || !spacesList().some(s => s.hid === captureDestVal() && s.type === 'circle')));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
