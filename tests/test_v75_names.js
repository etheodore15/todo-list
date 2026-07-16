// v75: names are always capitalized.
// Voice transcripts and casual typing arrive lowercase ("remind lulu…"); the
// app now capitalizes names everywhere they're stored going forward, migrates
// older stored todos/members once at boot, and capitalizes at display for the
// append-only event record (which is never rewritten).
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
    // everything seeded LOWERCASE, as older versions stored it
    localStorage.setItem('myName', JSON.stringify('alex'));
    localStorage.setItem('members', JSON.stringify(['lulu', 'emile']));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}]));
    const t = new Date().toISOString().slice(0,10);
    localStorage.setItem('todos', JSON.stringify([
      {id:'f1', text:'Take the bins out', priority:'low', tags:['lulu'], done:true, date:t,
       doneAt: now - DAY, space:'hh-fam', doneBy:'lulu', createdBy:'emile'},
      {id:'f2', text:'Return the library books', priority:'medium', tags:[], done:false, date:t,
       space:'hh-fam', assignees:['emile'], createdBy:'alex'},
      {id:'c1', text:'School shoes', priority:'medium', tags:[], done:true, date:t,
       doneAt: now - DAY, space:'hh-cop', doneBy:"o'brien", amount:120, expenseBy:"o'brien", expenseAt: now - DAY},
      {id:'t1', text:'Do my taxes', priority:'medium', tags:[], done:false, date:t}]));
    localStorage.setItem('events', JSON.stringify([
      {id:'e1', kind:'created', space:'hh-fam', who:'emile', ts: now - DAY, text:'Take the bins out'}]));
  });
  await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await p.waitForTimeout(500);

  // ---------- boot migration on stored data ----------
  const migrated = await p.evaluate(() => ({
    members: JSON.parse(localStorage.getItem('members')),
    t: JSON.parse(localStorage.getItem('todos')),
    evWho: JSON.parse(localStorage.getItem('events'))[0].who
  }));
  check('v75: members are capitalized in storage',
    migrated.members.join(',') === 'Lulu,Emile');
  check('v75: doneBy / createdBy / expenseBy migrated on old tasks',
    migrated.t.find(x => x.id === 'f1').doneBy === 'Lulu' &&
    migrated.t.find(x => x.id === 'f1').createdBy === 'Emile' &&
    migrated.t.find(x => x.id === 'f2').createdBy === 'Alex');
  check('v75: apostrophe names capitalize both parts (o\'brien → O\'Brien)',
    migrated.t.find(x => x.id === 'c1').doneBy === "O'Brien");
  check('v75: a member used as a tag is capitalized too',
    migrated.t.find(x => x.id === 'f1').tags.includes('Lulu'));
  check('v75: assignees migrated', migrated.t.find(x => x.id === 'f2').assignees[0] === 'Emile');
  check('v75: the append-only event record is NOT rewritten', migrated.evWho === 'emile');

  // ---------- new writes are capitalized (lowercase myName) ----------
  await p.click('nav.tabs button[data-view="today"]');
  await p.waitForTimeout(300);
  await p.evaluate(() => { const td = todos.find(t => t.id === 't1'); setDone(td, true); saveTodos(); });
  check('v75: a fresh tick stamps the capitalized name', await p.evaluate(() =>
    JSON.parse(localStorage.getItem('todos')).find(t => t.id === 't1').doneBy === 'Alex'));

  // ---------- displays ----------
  await p.evaluate(() => renderTodos());
  await p.waitForTimeout(200);
  const rowText = await p.locator('.todo', { hasText: 'Return the library books' }).textContent();
  check('v75: task scope chip shows the capitalized assignee', /Emile/.test(rowText));
  await p.evaluate(() => openFamilyReport(spacesList().find(s => s.type === 'family')));
  await p.waitForTimeout(400);
  const fam = await p.locator('#briefBody').textContent();
  check('v75: family report names are capitalized (from lowercase records)',
    /Lulu ticked off 1/.test(fam) && /Emile added 1/.test(fam) && !/lulu|emile/.test(fam));
  await p.evaluate(() => { document.getElementById('briefOverlay').style.display='none';
    openCoparentReport(spacesList().find(s => s.type === 'coparenting')); });
  await p.waitForTimeout(400);
  const cop = await p.locator('#briefBody').textContent();
  check('v75: co-parent report capitalizes the payer', /O'Brien paid \$120\.00/.test(cop));
  await p.evaluate(() => { document.getElementById('briefOverlay').style.display='none'; openHistory(spacesList()[0]); });
  await p.waitForTimeout(400);
  check('v75: history displays the recorded name capitalized (storage untouched)',
    /Emile/.test(await p.locator('#histList').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
