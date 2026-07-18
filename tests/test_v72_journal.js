// v72: the Ideas tab becomes the Journal — the app's review surface.
// Three sections: Reports (every report the user can generate, one tap, incl.
// the doctor briefing WITHOUT going through History), Notes (the old ideas
// list, unchanged), Records (per-space history/export + co-parenting ledger).
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

  const mk = async (init) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    if (init) await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- 1. multi-space user: full journal ----------
  const A = await mk(() => {
    const DAY = 86400000, now = Date.now();
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}]));
    const t = new Date().toISOString().slice(0,10);
    localStorage.setItem('todos', JSON.stringify([
      {id:'p1', text:'Renew the car registration', priority:'high', tags:[], done:true,
       date:t, doneAt: now - 2*DAY, energy:'high', minutes:60}]));
    localStorage.setItem('events', JSON.stringify([
      {id:'e1', kind:'note', space:'hh-care', who:'Alex', ts: now - 3600000, text:'Ate well, tired after physio'}]));
    localStorage.setItem('ideas', JSON.stringify([
      {id:'i1', raw:'remember the plumber quote felt high', summary:'remember the plumber quote felt high',
       priority:'low', engine:'built-in', ts: now - DAY}]));
  });

  check('v72: the tab is named Journal',
    /Journal/.test(await A.locator('nav.tabs button[data-view="ideas"]').textContent()));
  await A.click('nav.tabs button[data-view="ideas"]');
  await A.waitForTimeout(300);

  // Reports section
  check('v72: Reports section renders', /Reports/.test(await A.locator('#jrnReports').textContent()));
  check('v72: one report card per report — reflection + 3 spaces',
    await A.locator('#jrnReports .rep-card').count() === 4);
  const repText = await A.locator('#jrnReports').textContent();
  check('v72: cards name every cohort report',
    /My week in review/.test(repText) && /Doctor briefing/.test(repText) &&
    /Week report/.test(repText) && /Records summary/.test(repText));
  check('v72: cards say which space they cover',
    /Mum's care/.test(repText) && /Home/.test(repText) && /Kids/.test(repText));

  // The doctor briefing opens DIRECTLY from the card — no History detour
  await A.locator('#jrnReports .rep-card', { hasText: 'Doctor briefing' }).click();
  await A.waitForTimeout(400);
  check('v72: briefing card opens the report overlay directly',
    await A.locator('#briefOverlay').isVisible());
  check('v72: no History screen in the way',
    !(await A.locator('#histOverlay').isVisible()));
  check('v72: the brief includes the journal note',
    /physio/.test(await A.locator('#briefBody').textContent()));
  await A.click('#briefClose');
  await A.waitForTimeout(150);

  // Reflection card
  await A.locator('#jrnReports .rep-card', { hasText: 'My week in review' }).click();
  await A.waitForTimeout(400);
  check('v72: reflection card opens the report',
    /Renew the car registration/.test(await A.locator('#briefBody').textContent()));
  await A.click('#briefClose');
  await A.waitForTimeout(150);

  // Notes section — the old ideas list, intact
  check('v72: Notes heading present', await A.locator('#jrnNotesHead').isVisible());
  check('v72: captured notes still listed with their raw text',
    /plumber quote/.test(await A.locator('#ideasList').textContent()));

  // Records section
  check('v72: Records section lists every space',
    await A.locator('#jrnRecords .rec-row').count() === 3);
  check('v72: co-parenting row offers the ledger', await A.locator(
    '#jrnRecords .rec-row', { hasText: 'Kids' }).locator('.btn', { hasText: 'Ledger' }).count() === 1);
  await A.locator('#jrnRecords .rec-row', { hasText: 'Home' }).locator('.btn', { hasText: 'History' }).click();
  await A.waitForTimeout(300);
  check('v72: records row opens the space history', await A.locator('#histOverlay').isVisible());
  await A.click('#histClose');

  // ---------- 2. solo user: reflection card only, kind empty notes ----------
  const B = await mk(() => localStorage.setItem('onboarded', 'true'));
  await B.click('nav.tabs button[data-view="ideas"]');
  await B.waitForTimeout(300);
  check('v72: solo user still gets the week-in-review card',
    await B.locator('#jrnReports .rep-card').count() === 1);
  check('v72: no Records section without spaces',
    await B.locator('#jrnRecords .rec-row').count() === 0);
  check('v72: notes empty state explains what lands here',
    /No notes yet/.test(await B.locator('#ideasList').textContent()));

  // ---------- 3. v73: open tasks IN the reports ----------
  const E = await mk(() => {
    const DAY = 86400000, now = Date.now();
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}}]));
    const t = new Date().toISOString().slice(0,10);
    localStorage.setItem('todos', JSON.stringify([
      {id:'p1', text:'Renew the car registration', priority:'high', tags:[], done:true,
       date:t, doneAt: now - 2*DAY, energy:'high', minutes:60},
      {id:'p2', text:'File the insurance claim', priority:'medium', tags:[], done:false, date:t, createdBy:'Alex'},
      {id:'i2-0', text:'Call the plumber', priority:'medium', tags:[], done:false, date:t, ideaId:'i2', createdBy:'Alex'},
      {id:'f1', text:'Fix the gate', priority:'medium', tags:[], done:false, space:'hh-fam', createdBy:'Alex'}]));
    localStorage.setItem('ideas', JSON.stringify([
      {id:'i2', raw:'call the plumber about the hot water', summary:'call the plumber about the hot water',
       priority:'medium', engine:'built-in', ts: now - DAY}]));
  });
  await E.evaluate(() => openReflection());
  await E.waitForTimeout(400);
  const refl2 = await E.locator('#briefBody').textContent();
  check('v73: week in review lists the open tasks, not just a count',
    /Still open/.test(refl2) && /File the insurance claim/.test(refl2));
  await E.evaluate(() => { document.getElementById('briefOverlay').style.display='none';
    openFamilyReport(spacesList().find(s => s.type === 'family')); });
  await E.waitForTimeout(400);
  check('v73: family week report lists its open tasks',
    /Still open/.test(await E.locator('#briefBody').textContent()) &&
    /Fix the gate/.test(await E.locator('#briefBody').textContent()));
  await E.evaluate(() => { document.getElementById('briefOverlay').style.display='none'; });

  // ---------- 4. v73: a journal share can be taken back (both entries logged) ----------
  await E.click('nav.tabs button[data-view="ideas"]');
  await E.waitForTimeout(300);
  await E.locator('.card .share-note', { hasText: "Share to Mum's care" }).click();
  await E.waitForTimeout(200);
  // v85: every space gets a share chip, so scope the locator to the care one
  check('v73: shared chip now offers removal',
    /in Mum's care journal · remove/.test(await E.locator('.card .share-note', { hasText: "Mum's care" }).textContent()));
  check('v73: the share itself is in the record', await E.evaluate(() =>
    JSON.parse(localStorage.getItem('events')).some(e => e.kind === 'note' && /plumber/.test(e.text))));
  check('v73: briefing would include the note before removal', await E.evaluate(async () => {
    histEvents = await collectSpaceEvents(spacesList()[0]);
    return briefingInput(spacesList()[0]).notes.length === 1;
  }));
  await E.locator('.card .share-note', { hasText: "Mum's care" }).click();   // take it back
  await E.waitForTimeout(200);
  check('v73: removal logged as its own append-only entry', await E.evaluate(() =>
    JSON.parse(localStorage.getItem('events')).some(e => e.kind === 'note-removed')));
  check('v73: note and removal pair via the same record id', await E.evaluate(() => {
    const evs = JSON.parse(localStorage.getItem('events'));
    const n = evs.find(e => e.kind === 'note'), r = evs.find(e => e.kind === 'note-removed');
    return n && r && n.taskId === r.taskId;
  }));
  check('v73: chip returns to offering the share',
    /Share to Mum's care/.test(await E.locator('.card .share-note', { hasText: "Mum's care" }).textContent()));
  check('v73: the briefing excludes the removed note', await E.evaluate(async () => {
    histEvents = await collectSpaceEvents(spacesList()[0]);
    return briefingInput(spacesList()[0]).notes.length === 0;
  }));
  await E.evaluate(() => openHistory(spacesList()[0]));
  await E.waitForTimeout(400);
  const histText = await E.locator('#histList').textContent();
  check('v73: history shows BOTH the note and its removal',
    /noted/.test(histText) && /removed the note/.test(histText));
  await E.click('#histClose');

  // ---------- 5. v73: move a task to another space from the Journal ----------
  await E.waitForTimeout(200);
  check('v73: journal task rows offer a move button',
    await E.locator('.card .mini-task .mmove').count() === 1);
  await E.locator('.card .mini-task .mmove').click();
  await E.waitForTimeout(200);
  check('v73: move button opens the same scope sheet as Today',
    await E.locator('#scopeSheet').isVisible());
  await E.locator('#scopeSpaces .btn', { hasText: 'Home' }).click();
  await E.waitForTimeout(300);
  check('v73: the task now lives in the chosen space', await E.evaluate(() =>
    JSON.parse(localStorage.getItem('todos')).find(t => t.id === 'i2-0').space === 'hh-fam'));
  check('v73: the move is in the space record', await E.evaluate(() =>
    JSON.parse(localStorage.getItem('events')).some(e => e.kind === 'moved' && /plumber/i.test(e.text))));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
