// v63: capture is instant, structuring runs in the background.
// - Tapping "Summarize & Add" stores the idea and clears the box immediately;
//   the idea shows a "structuring…" chip until the pipeline lands.
// - Pending ideas survive a reload and resume on boot.
// - The processing strip shows while ideas are in flight.
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
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(seed || (() => {
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
      localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
    }));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- instant capture: box clears at once, idea goes pending → done ----------
  const A = await mk();
  await A.click('nav.tabs button[data-view="capture"]');
  // slow the structuring artificially so the pending state is observable:
  // a stored key makes aiEnabled() true; geminiSummarize (a hoisted function
  // declaration) is replaceable via the window binding
  await A.evaluate(() => {
    store.set('geminiKey', 'fake-key-for-test');
    window.geminiSummarize = () => new Promise(res => setTimeout(() =>
      res({summary: 'Call the plumber about the hot water', priority: 'high',
           tasks: [{text: 'Call the plumber about the hot water', priority: 'high', tags: ['home']}]}), 900));
  });
  await A.fill('#liveText', 'call the plumber about the hot water tomorrow morning');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(200);
  check('v63: input clears immediately (no blocking spinner)',
    await A.evaluate(() => document.getElementById('liveText').value === ''));
  check('v63: processing strip shows while structuring',
    await A.locator('#procStrip').isVisible());
  check('v63: idea is stored instantly with a pending flag',
    await A.evaluate(() => ideas[0] && ideas[0].pending === true));
  await A.click('nav.tabs button[data-view="ideas"]');
  await A.waitForTimeout(150);
  check('v63: idea card shows a structuring chip', /structuring…/.test(await A.locator('#ideasList').textContent()));
  await A.waitForTimeout(1200);   // let the delayed pipeline finish
  check('v63: structuring completes in the background',
    await A.evaluate(() => !ideas[0].pending && ideas[0].engine === 'gemini'));
  check('v63: the task landed in the destination space',
    await A.evaluate(() => todos.some(t => /plumber/i.test(t.text) && t.space === 'hh-care')));
  check('v63: completion toast says where it went',
    /live in “Mum's care”/.test(await A.locator('#toast').textContent()));
  check('v63: processing strip cleared', !(await A.locator('#procStrip').isVisible()));

  // ---------- pending ideas resume after a reload ----------
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('ideas', JSON.stringify([{id:'i-cut', raw: 'buy replacement filters for the air purifier',
      summary: 'buy replacement filters…', priority: 'medium', engine: 'built-in', pending: true, dest: 'hh-care', ts: Date.now()}]));
  });
  await B.waitForTimeout(800);   // boot resume runs the built-in pipeline
  check('v63: a pending idea resumes on boot',
    await B.evaluate(() => !ideas[0].pending));
  check('v63: resumed idea produced its task in the saved destination',
    await B.evaluate(() => todos.some(t => /filters/i.test(t.text) && t.space === 'hh-care')));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
