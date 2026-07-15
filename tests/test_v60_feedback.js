// v60: fixes from first real-user testing (the founder's daughter).
// 1. Built-in extraction understands past/passive intent ("needed to be dropped
//    off", "had to be picked up"), spelled-out times ("nine AM", "by twelve PM"),
//    splits drop-off + pick-up into two timed tasks, and break-down steps are
//    specific to outings (leave-by alarm at the task's own time).
// 2. Saving/sharing to a space journal shows WHERE it went (View action opens
//    the journal); "Added N tasks" names the destination space.
// 3. Doctor briefing with nothing recorded explains itself instead of silently
//    producing an empty report.
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

  const mk = async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('myName', JSON.stringify('Alex'));
      localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
      localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
      // no AI key anywhere — everything below must work on the built-in engine
    });
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- 1. the daughter's transcript → two specific, timed tasks ----------
  const A = await mk();
  await A.click('nav.tabs button[data-view="capture"]');
  await A.fill('#liveText',
    'um she needed to be dropped off at a play center for an arts and crafts event at nine AM and had to be picked up by twelve PM or later');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(600);
  const made = await A.evaluate(() => todos.map(t => ({text: t.text, time: t.time, space: t.space})));
  console.log('  extracted:', JSON.stringify(made));
  check('T1: two tasks extracted from one compound sentence', made.length === 2);
  const drop = made.find(t => /^drop off/i.test(t.text));
  const pick = made.find(t => /^pick(ed)? up|^pick up/i.test(t.text));
  check('T1: drop-off task keeps the place + event specifics',
    !!drop && /play center/i.test(drop.text) && /arts and crafts/i.test(drop.text));
  check('T1: drop-off gets the spoken time (nine AM → 09:00)', !!drop && drop.time === '09:00');
  check('T1: pick-up task extracted with its own time (twelve PM → 12:00)', !!pick && pick.time === '12:00');
  check('T1: tasks published into the active space', made.every(t => t.space === 'hh-care'));
  check('T1: after adding, the user is taken to Today (not left on capture)',
    await A.evaluate(() => document.getElementById('view-today').classList.contains('active')));
  const addToast = await A.locator('#toast').textContent();
  check('T2: the toast names the destination space', /Mum's care/.test(addToast));

  // ---------- 1b. break-down steps specific to the outing ----------
  const steps = await A.evaluate(async () => {
    const td = todos.find(t => /^drop off/i.test(t.text));
    breakDown(td);                      // no AI → localBreakdown, synchronous enough
    await new Promise(r => setTimeout(r, 300));
    return (todos.find(t => /^drop off/i.test(t.text)).subtasks || []).map(s => s.text || s);
  });
  console.log('  steps:', JSON.stringify(steps));
  check('T1: outing break-down anchors to the task\'s own time (9am alarm)',
    steps.some(s => /9am/i.test(s)) && steps.some(s => /leave-by alarm/i.test(s)));
  check('T1: no generic just-start filler for outings', !steps.some(s => /2-minute timer/i.test(s)));

  // ---------- 2. care-note save says WHERE it went, View opens the journal ----------
  const B = await mk();
  await B.click('nav.tabs button[data-view="capture"]');
  await B.fill('#liveText', 'Mum was cheerful and ate everything at lunch.');
  await B.click('#saveNoteBtn');
  await B.waitForTimeout(250);
  check('T2: note toast names the journal', /Mum's care journal/.test(await B.locator('#toast').textContent()));
  check('T2: toast offers a View action (not Undo)',
    (await B.locator('#toast .undo').textContent()) === 'View');
  await B.click('#toast .undo');
  await B.waitForTimeout(400);
  check('T2: View opens the space history (journal) overlay',
    await B.locator('#histOverlay').isVisible());
  check('T2: the saved note is visible in the journal',
    /cheerful/.test(await B.locator('#histOverlay').textContent()));

  // ---------- 3. empty doctor briefing explains itself ----------
  const C = await mk();
  await C.evaluate(() => openHistory(spacesList()[0]));
  await C.waitForTimeout(300);
  await C.click('#histBriefBtn');
  await C.waitForTimeout(300);
  check('T3: with nothing recorded, no empty report overlay opens',
    !(await C.locator('#briefOverlay').isVisible()));
  check('T3: the user is told what to do instead',
    /Nothing to brief yet/i.test(await C.locator('#toast').textContent()));

  // ---------- 3b. with data, the briefing still opens ----------
  await C.click('#histClose');
  await C.click('nav.tabs button[data-view="capture"]');
  await C.fill('#liveText', 'Slept badly, complained of a sore hip.');
  await C.click('#saveNoteBtn');
  await C.waitForTimeout(250);
  await C.evaluate(() => openHistory(spacesList()[0]));
  await C.waitForTimeout(300);
  await C.click('#histBriefBtn');
  await C.waitForTimeout(500);
  check('T3: with a note recorded, the briefing renders',
    await C.locator('#briefOverlay').isVisible() &&
    /sore hip/.test(await C.locator('#briefBody').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
