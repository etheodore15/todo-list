// v68: capture destination + report reachability + report detail.
// - The capture screen shows an "Add to" chip row (Private + every space) so a
//   member of several spaces SAYS where a voice note lands instead of guessing.
// - Picking a care space offers the journal save; task creation stays PRIMARY
//   ("Summarize & Add"), the journal save is the secondary ghost button.
// - The personal week-in-review is reachable from the focus toolkit and from a
//   personal-view action bar, not only inside the collapsed Wins block.
// - Space reports carry itemized detail: who/when per finished task, dated
//   expense line items.
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

  const MULTI = () => {
    const DAY = 86400000, now = Date.now();
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('cohorts', JSON.stringify(['adhd']));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}]));
    const t = new Date().toISOString().slice(0,10);
    localStorage.setItem('todos', JSON.stringify([
      {id:'p1', text:'Renew the car registration', priority:'high', tags:[], done:true,
       date:t, doneAt: now - 2*DAY, energy:'high', minutes:60},
      {id:'f1', text:'Take the bins out', priority:'low', tags:[], done:true, date:t,
       doneAt: now - 1*DAY, space:'hh-fam', doneBy:'Lulu'},
      {id:'c1', text:'School shoes', priority:'medium', tags:[], done:true, date:t,
       doneAt: now - 2*DAY, space:'hh-cop', doneBy:'Alex', amount:120, expenseBy:'Alex', expenseAt: now - 2*DAY}]));
  };

  // ---------- 1. destination chips on the capture screen ----------
  const A = await mk(MULTI);
  check('v68: capture shows the Add-to destination row', await A.locator('#destRow').isVisible());
  check('v68: Private + every space offered as a destination',
    await A.locator('#destChips .fchip').count() === 4);
  // the default follows where captures already went (the default space) — the
  // chip row makes that destination VISIBLE instead of a surprise
  check('v68: the default destination is shown as the active chip',
    /Mum's care/.test(await A.locator('#destChips .fchip.active').textContent()));

  // pick a space → the saved capture's tasks land THERE
  await A.locator('#destChips .fchip', { hasText: 'Kids' }).click();
  await A.waitForTimeout(100);
  check('v68: picking a destination marks its chip active',
    /Kids/.test(await A.locator('#destChips .fchip.active').textContent()));
  await A.fill('#liveText', 'book the school excursion bus by friday');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(900);
  const dest = await A.evaluate(() =>
    JSON.parse(localStorage.getItem('todos')).find(t => /excursion bus/.test(t.text)).space);
  check('v68: tasks from the capture land in the chosen space', dest === 'hh-cop');
  check('v68: the choice sticks for the next capture',
    /Kids/.test(await A.locator('#destChips .fchip.active').textContent()));

  // ---------- 2. care destination → journal offered, task button stays primary ----------
  await A.locator('#destChips .fchip', { hasText: "Mum's care" }).click();
  await A.waitForTimeout(100);
  check('v68: picking a care space offers the journal save', await A.locator('#saveNoteBtn').isVisible());
  check('v68: journal button names the journal',
    /Mum's care journal/.test(await A.locator('#saveNoteBtn').textContent()));
  check('v68: task creation is the PRIMARY button (Summarize & Add)',
    await A.evaluate(() => document.getElementById('saveIdeaBtn').classList.contains('primary')
      && document.getElementById('saveIdeaBtn').textContent === 'Summarize & Add'));
  check('v68: journal save is the secondary (ghost) button',
    await A.evaluate(() => document.getElementById('saveNoteBtn').classList.contains('ghost')
      && !document.getElementById('saveNoteBtn').classList.contains('primary')));
  await A.fill('#liveText', 'Mum seemed brighter today, ate a full dinner.');
  await A.click('#saveNoteBtn');
  await A.waitForTimeout(300);
  check('v68: the note lands in the chosen care journal', await A.evaluate(() =>
    JSON.parse(localStorage.getItem('events') || '[]')
      .some(e => e.kind === 'note' && e.space === 'hh-care' && /full dinner/.test(e.text))));

  // back to Private → journal option leaves, primary unchanged
  await A.locator('#destChips .fchip', { hasText: 'Private' }).click();
  await A.waitForTimeout(100);
  check('v68: Private destination hides the journal save',
    !(await A.locator('#saveNoteBtn').isVisible()));

  // ---------- 3. week-in-review reachability ----------
  await A.click('nav.tabs button[data-view="today"]');
  await A.waitForTimeout(300);
  check('v68: focus toolkit offers Week in review',
    await A.locator('#adhdStrip .space-act', { hasText: 'Week in review' }).count() === 1);
  await A.locator('#adhdStrip .space-act', { hasText: 'Week in review' }).click();
  await A.waitForTimeout(500);
  check('v68: toolkit button opens the report overlay', await A.locator('#briefOverlay').isVisible());
  const refl = await A.locator('#briefBody').textContent();
  check('v68: reflection itemizes day + effort per finished task',
    /Renew the car registration/.test(refl) && /1h/.test(refl) && /high effort/.test(refl));
  await A.click('#briefClose');
  // the Personal filter view gets its own action bar with the report
  await A.locator('#spaceFilter .fchip', { hasText: 'Personal' }).click();
  await A.waitForTimeout(300);
  check('v68: personal view shows a My-week-in-review action bar',
    await A.locator('#spaceBar .space-act', { hasText: 'My week in review' }).count() === 1);

  // ---------- 4. report detail: who/when + dated expense lines ----------
  await A.evaluate(() => openFamilyReport(spacesList().find(s => s.type === 'family')));
  await A.waitForTimeout(400);
  const fam = await A.locator('#briefBody').textContent();
  check('v68: family report itemizes finished tasks with who and when',
    /Take the bins out/.test(fam) && /Lulu ·/.test(fam));
  await A.evaluate(() => { document.getElementById('briefOverlay').style.display='none'; openCoparentReport(spacesList().find(s => s.type === 'coparenting')); });
  await A.waitForTimeout(400);
  const cop = await A.locator('#briefBody').textContent();
  check('v68: co-parent report lists each expense with payer and date',
    /School shoes — \$120\.00/.test(cop) && /paid by Alex ·/.test(cop));
  check('v68: co-parent report itemizes completions with who and when',
    /Completed — the detail/.test(cop));

  // ---------- 5. no spaces → no destination row ----------
  const B = await mk(() => localStorage.setItem('onboarded', 'true'));
  check('v68: no spaces → no destination row', !(await B.locator('#destRow').isVisible()));

  // ---------- 6. v69 regression: family default + care space also present ----------
  // Bug: the chips defaulted to the family space but "Save to journal" still
  // showed (old single-care fallback). The journal save must track the chips.
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-fam'));
  });
  check('v69: default chip is the family space',
    /Home/.test(await C.locator('#destChips .fchip.active').textContent()));
  check('v69: NO journal button while the destination is the family space',
    !(await C.locator('#saveNoteBtn').isVisible()));
  await C.locator('#destChips .fchip', { hasText: "Mum's care" }).click();
  await C.waitForTimeout(100);
  check('v69: picking the care chip brings the journal save back',
    await C.locator('#saveNoteBtn').isVisible());
  await C.locator('#destChips .fchip', { hasText: 'Private' }).click();
  await C.waitForTimeout(100);
  check('v69: switching to Private hides it again',
    !(await C.locator('#saveNoteBtn').isVisible()));

  // ---------- 7. v70 regression: briefing stacks ABOVE history; bar wraps ----------
  const D = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}},
      {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('events', JSON.stringify([
      {id:'e1', kind:'note', space:'hh-care', who:'Alex', ts: Date.now(), text:'Ate well today'}]));
  });
  await D.setViewportSize({ width: 390, height: 844 });
  await D.click('nav.tabs button[data-view="today"]');
  await D.waitForTimeout(300);
  // filter to the care space so its action bar renders, then check nothing clips
  await D.locator('#spaceFilter .fchip', { hasText: "Mum's care" }).click();
  await D.waitForTimeout(300);
  const clipped = await D.evaluate(() => {
    const bar = document.querySelector('#spaceBar .space-bar');
    return [...bar.querySelectorAll('.space-act')].some(b => {
      const r = b.getBoundingClientRect();
      return r.right > innerWidth || r.left < 0;
    });
  });
  check('v70: care action bar wraps — no button clipped off-screen', clipped === false);
  // doctor briefing must open ON TOP of the history overlay, not underneath it
  await D.evaluate(() => openHistory(spacesList().find(s => s.type === 'care')));
  await D.waitForTimeout(300);
  await D.click('#histBriefBtn');
  await D.waitForTimeout(200);
  const stack = await D.evaluate(() => ({
    briefShown: document.getElementById('briefOverlay').style.display !== 'none',
    briefZ: +getComputedStyle(document.getElementById('briefOverlay')).zIndex,
    histZ: +getComputedStyle(document.getElementById('histOverlay')).zIndex
  }));
  check('v70: briefing overlay opens above the history screen (z-order)',
    stack.briefShown && stack.briefZ > stack.histZ);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
