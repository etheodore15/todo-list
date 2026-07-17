// v80: Cooee Phase 3 — plan goals, the Plan Review Pack, claim-ready expenses.
// - Plan goals live on the household doc (owner/co-admin edit — rules enforce);
//   each derives a ≤16-char tag; tagging work with it groups progress in the
//   pack. Goals feed the structuring prompt and lead the tag picker.
// - The Plan Review Pack: 12 weeks grouped by goal + sessions + incidents +
//   adherence + open tasks + expenses. Every render carries the disclaimer
//   "Participant-owned coordination record. Not medical, legal, or NDIS
//   advice." No per-worker totals anywhere.
// - Circle expenses gain provider/ABN + support date; the ledger CSV gains
//   support_date / provider_abn / receipt_ref columns (circle only).
const { chromium } = require('playwright');

const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1'};`;
const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_AUTH = `
  export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
  export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
  export async function signInAnonymously(a){ a.currentUser={uid:'u1', getIdToken: async()=>'T'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
const FAKE_FS = `
  export function initializeFirestore(){ return {}; }
  export function persistentLocalCache(){ return {}; }
  export function collection(db,...p){ return {path:p.join('/')}; }
  export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
  export function query(col, ...cs){ return {path:col.path, filters:cs}; }
  export function where(f, op, v){ return {f, op, v}; }
  export async function setDoc(ref, data, opts){ (window.__writes = window.__writes || []).push({path:ref.path, data, opts}); }
  export async function deleteDoc(){}
  export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
  export function onSnapshot(t, cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (init) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('onboarded', 'true'); } catch(e){} });
    if (init) await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(600);
    return p;
  };

  const NOW = 'const N = Date.now();';
  const seedOwner = () => {
    localStorage.setItem('myName', JSON.stringify('Blaire'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cir', name: 'My Circle', type: 'circle', cfg: null, managed: true, role: 'owner',
       circle: {participant: 'Blaire', mode: 'self'}},
      {hid: 'hh-fam', name: 'Home', type: 'family', cfg: null, managed: true}]));
    localStorage.setItem('planGoals', JSON.stringify({'hh-cir': ['Cook meals', 'Get out and about more often']}));
    const N = Date.now();
    localStorage.setItem('events', JSON.stringify([
      {id: 'e1', ts: N - 86400000 * 2, who: 'Ana', kind: 'session-start', taskId: 'ses-1', text: 'support session', space: 'hh-cir'},
      {id: 'e2', ts: N - 86400000 * 2 + 7200000, who: 'Ana', kind: 'session-end', taskId: 'ses-1', text: 'support session', space: 'hh-cir'},
      {id: 'e3', ts: N - 86400000, who: 'Ana', kind: 'note', taskId: 'n1', text: 'Blaire cooked pasta almost solo', space: 'hh-cir', tags: ['cook meals']},
      {id: 'e4', ts: N - 86400000, who: 'Ana', kind: 'note', taskId: 'n2', text: 'calm afternoon in the garden', space: 'hh-cir'},
      {id: 'e5', ts: N - 3600000, who: 'Ana', kind: 'incident', taskId: 'i1', text: 'slipped in the bathroom', space: 'hh-cir', detail: 'present: just us'},
      {id: 'e6', ts: N - 3600000, who: null, kind: 'missed', taskId: 'm1', text: 'Morning meds 8:00', space: 'hh-cir'},
      {id: 'e7', ts: N - 7200000, who: 'Jo', kind: 'ticked', taskId: 't1', text: 'Shop for dinner ingredients', space: 'hh-cir', tags: ['cook meals']},
      {id: 'e8', ts: N - 7200000, who: 'Jo', kind: 'expense', taskId: 't2', text: 'Taxi to the pool', space: 'hh-cir', detail: '$42.50'}]));
    localStorage.setItem('todos', JSON.stringify([
      {id: 'op1', text: 'Book cooking class', priority: 'low', space: 'hh-cir', tags: ['cook meals'], done: false}]));
  };

  // ---------- 1. goal tags ----------
  const A = await mk(seedOwner);
  check('v80: goalTag keeps short labels whole', await A.evaluate(() => goalTag('Cook meals') === 'cook meals'));
  check('v80: goalTag cuts long labels at a word boundary within 16', await A.evaluate(() =>
    goalTag('Get out and about more often') === 'get out and' && goalTag('Cooking for myself') === 'cooking for'));

  // ---------- 2. goals sheet: add, remove, sync to the household doc ----------
  await A.evaluate(() => { window.__writes = []; openGoalsSheet(spacesList()[0]); });
  await A.waitForTimeout(200);
  check('v80: goals sheet lists current goals with their tags',
    /Cook meals/.test(await A.locator('#goalsList').textContent()) &&
    /#cook meals/.test(await A.locator('#goalsList').textContent()));
  await A.fill('#goalNew', 'Keep the garden alive');
  await A.click('#goalAdd');
  await A.waitForTimeout(200);
  const goalWrite = await A.evaluate(() => (window.__writes || []).find(w => w.path === 'households/hh-cir' && w.data.planGoals));
  check('v80: adding a goal writes planGoals to the household doc',
    goalWrite && goalWrite.data.planGoals.includes('Keep the garden alive') && goalWrite.data.planGoals.length === 3);
  await A.locator('#goalsList .goal-row button').first().click();   // remove "Cook meals"
  await A.waitForTimeout(200);
  check('v80: removing a goal updates the list and syncs', await A.evaluate(() =>
    !planGoals('hh-cir').includes('Cook meals') && planGoals('hh-cir').length === 2 &&
    (window.__writes || []).filter(w => w.path === 'households/hh-cir' && w.data.planGoals).length === 2));
  await A.evaluate(() => { setPlanGoals('hh-cir', ['Cook meals', 'Get out and about more often']); closeGoalsSheet(); });

  // ---------- 3. goals feed the prompt and the tag picker ----------
  const prompt = await A.evaluate(() => { captureDest = 'hh-cir'; return buildIdeaPrompt('book a cooking class'); });
  check('v80: prompt lists the goals with their exact tags',
    /plan goals: "Cook meals" \(tag: cook meals\)/.test(prompt) && /"Get out and about more often" \(tag: get out and\)/.test(prompt));
  check('v80: prompt forbids forcing goal tags', /Never force a goal tag/.test(prompt));
  const famPrompt = await A.evaluate(() => { captureDest = 'hh-fam'; return buildIdeaPrompt('bins out'); });
  check('v80: non-circle prompt untouched', !/plan goals/.test(famPrompt));
  await A.evaluate(() => openTagSheet(todos.find(t => t.id === 'op1')));
  await A.waitForTimeout(200);
  const tagList = await A.evaluate(() => [...document.querySelectorAll('#tagChoices input')].map(i => i.value));
  check('v80: circle task tag picker offers the goal tags',
    tagList.includes('cook meals') && tagList.includes('get out and'));
  await A.evaluate(() => closeTagSheet());

  // ---------- 4. circle setup checklist includes goals ----------
  await A.evaluate(() => guideSpaceSetup(spacesList()[0]));
  await A.waitForTimeout(200);
  check('v80: circle setup has an "Add your plan goals" step',
    /Add your plan goals/.test(await A.locator('#setupSteps').textContent()));
  await A.evaluate(() => { document.getElementById('setupSheet').style.display = 'none'; });

  // ---------- 5. the Plan Review Pack ----------
  await A.evaluate(() => openPlanPack(spacesList()[0]));
  for (let i = 0; i < 10; i++){
    if (/Plan Review Pack/.test(await A.locator('#briefBody').textContent())) break;
    await A.waitForTimeout(300);
  }
  const pack = await A.locator('#briefBody').innerHTML();
  check('v80: pack opens in the report overlay with the title',
    await A.locator('#briefOverlay').isVisible() && /My Circle — Plan Review Pack/.test(pack));
  check('v80: the disclaimer is on the pack',
    /Participant-owned coordination record\. Not medical, legal, or NDIS advice\./.test(pack));
  check('v80: progress groups under the goal',
    /Goal: Cook meals/.test(pack) && /cooked pasta almost solo/.test(pack) && /Shop for dinner ingredients/.test(pack));
  check('v80: an empty goal explains how to feed it',
    /Nothing recorded under this goal yet/.test(pack) && /get out and/.test(pack));
  check('v80: participant is the grammatical subject of the overview',
    /Blaire's coordination record/.test(pack));
  check('v80: sessions listed as records — paired times, no totals',
    /Support sessions \(as recorded\)/.test(pack) && / to /.test(pack) && !/total hours|hours worked|per worker/i.test(pack));
  check('v80: incidents, missed routines, open tasks and expenses all present',
    /slipped in the bathroom/.test(pack) && /not recorded as done/.test(pack) &&
    /Book cooking class \(plan goal\)/.test(pack) && /\$42\.50/.test(pack) && /42\.50 total/.test(pack));
  await A.click('#briefClose');

  // journal tab offers the pack
  await A.click('nav.tabs button[data-view="ideas"]');
  await A.waitForTimeout(300);
  check('v80: Journal reports include the Plan Review Pack card',
    /Plan Review Pack/.test(await A.locator('#jrnReports').textContent()));

  // empty circle → guidance, not an empty report
  const B = await mk(() => {
    localStorage.setItem('myName', JSON.stringify('Blaire'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-new', name: 'Fresh Circle', type: 'circle', cfg: null, managed: true, role: 'owner'}]));
  });
  await B.evaluate(() => openPlanPack(spacesList()[0]));
  await B.waitForTimeout(500);
  check('v80: an empty record gets guidance instead of a blank pack',
    /Nothing to pack yet/.test(await B.locator('#toast').textContent()) &&
    await B.evaluate(() => document.getElementById('briefOverlay').style.display !== 'flex'));

  // ---------- 6. claim-ready expenses ----------
  await A.click('nav.tabs button[data-view="today"]');
  await A.evaluate(() => { window.__writes = []; openExpense(todos.find(t => t.id === 'op1')); });
  await A.waitForTimeout(200);
  check('v80: circle expense sheet shows provider + support date',
    await A.locator('#expCircleFields').isVisible() &&
    /Provider/.test(await A.locator('#expCircleFields').textContent()));
  await A.fill('#expAmount', '95.00');
  await A.fill('#expProvider', 'Sunshine OT — ABN 12 345 678 901');
  await A.fill('#expDate', '2026-07-15');
  await A.click('#expSave');
  await A.waitForTimeout(300);
  const rcW = await A.evaluate(() => (window.__writes || []).find(w => /receipts/.test(w.path)));
  check('v80: the receipt carries provider, support date, vis + author',
    rcW && rcW.data.provider === 'Sunshine OT — ABN 12 345 678 901' && rcW.data.supportDate === '2026-07-15'
      && rcW.data.vis === 'circle' && rcW.data.authorUid === 'u1');
  // family expense: no circle fields, receipt keeps nulls
  await A.evaluate(() => {
    todos.push({id: 'tf', text: 'School shoes', priority: 'low', space: 'hh-fam'});
    openExpense(todos.find(t => t.id === 'tf'));
  });
  await A.waitForTimeout(200);
  check('v80: family expense sheet hides the circle fields',
    await A.evaluate(() => document.getElementById('expCircleFields').style.display === 'none'));
  await A.evaluate(() => { window.__writes = []; });
  await A.fill('#expAmount', '60');
  await A.click('#expSave');
  await A.waitForTimeout(300);
  const rcF = await A.evaluate(() => (window.__writes || []).find(w => /receipts/.test(w.path)));
  check('v80: family receipt has no provider/support date values and no vis',
    rcF && rcF.data.provider === null && rcF.data.supportDate === null && !('vis' in rcF.data));

  // ---------- 7. the CSV columns ----------
  const csv = await A.evaluate(() => {
    const sp = spacesList().find(s => s.hid === 'hh-cir');
    const rows = ledgerCsvRows(sp, [{id: 'rc-op1', ts: Date.now(), who: 'Blaire', note: 'Book cooking class',
      amount: 95, thumb: null, provider: 'Sunshine OT — ABN 12 345 678 901', supportDate: '2026-07-15'}]);
    return rows.join('\n');
  });
  check('v80: circle CSV gains support_date / provider_abn / receipt_ref',
    /support_date,provider_abn,receipt_ref/.test(csv) && /"2026-07-15","Sunshine OT — ABN 12 345 678 901","rc-op1"/.test(csv));
  const famCsv = await A.evaluate(() => {
    const sp = spacesList().find(s => s.hid === 'hh-fam');
    return ledgerCsvRows(sp, [{id: 'rc-tf', ts: Date.now(), who: 'Blaire', note: 'School shoes', amount: 60, thumb: null}]).join('\n');
  });
  check('v80: family CSV keeps exactly the original columns',
    /^timestamp,date,who,task,amount,has_receipt$/m.test(famCsv) && !/provider/.test(famCsv));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
