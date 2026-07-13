// v47: correctness fixes surfaced by the flow audit —
//  (1) ledger splits across the space's parents, not just whoever logged;
//  (2) missed doses aren't falsely attributed to the device that ran rollover;
//  (3) delegation fails OPEN on a name mismatch (never silently hides a task);
//  (4) past-tense speech doesn't create open to-dos;
//  (5) the post-create setup checklist stays open (doesn't self-destruct);
//  (6) Escape doesn't finalize first-run onboarding.
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
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    if (seed) await page.addInitScript(seed);
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  // ---------- 1. ledger split across parents ----------
  const A = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Sam'));
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('spaceMembers', JSON.stringify({'hh-cop': ['Sam', 'Alex']}));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
  });
  // one-sided ledger: only Sam has paid; owes must still resolve
  const oneSided = await A.evaluate(() => {
    const b = ledgerBalances([
      {who:'Sam', amount: 100}, {who:'sam', amount: 40}   // note case variance
    ], 'hh-cop');
    return b;
  });
  check('v47: one-sided ledger still computes an owes line', !!oneSided.owes);
  check('v47: split is across the 2 parents ($70 each), case-normalized',
    Math.abs(oneSided.share - 70) < 0.001 && oneSided.balances.length === 2);
  check('v47: the non-paying parent owes the payer $70',
    oneSided.owes && /alex/i.test(oneSided.owes.from) && Math.abs(oneSided.owes.amount - 70) < 0.001);

  // ---------- 2. missed-dose attribution ----------
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Emile'));
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:'Mum', type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
    // a care recur task whose date is in the past + unfinished → rollover marks it missed
    localStorage.setItem('todos', JSON.stringify([
      {id:'m1', text:'Metformin 500mg', priority:'high', tags:['meds'], done:false,
       date:'2020-01-01', recur:{type:'daily'}, time:'08:00', space:'hh-care', med:{name:'Metformin 500mg'}}]));
  });
  await B.evaluate(() => rollover());
  const missed = await B.evaluate(() => {
    const evs = JSON.parse(localStorage.getItem('events') || '[]');
    return evs.find(e => e.kind === 'missed');
  });
  check('v47: rollover logged a missed event', !!missed);
  check('v47: missed dose is NOT attributed to the device owner (who is null)',
    missed && missed.who === null);

  // ---------- 3. delegation fails open on a name mismatch ----------
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Lu'));    // saved as "Lu"...
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('spaceMembers', JSON.stringify({'hh-fam': ['Emile', 'Lulu']}));   // ...but rostered as "Lulu"
  });
  const vis = await C.evaluate(() => {
    // task delegated to "lulu" — I'm "Lu", not in assignees and not in the roster
    return {
      mismatch: visibleToMe({space:'hh-fam', assignees:['lulu'], createdBy:'emile'}),
      // a correctly-rostered member NOT assigned still doesn't see it
      rostered: (function(){ localStorage.setItem('myName', JSON.stringify('Emile')); return null; })()
    };
  });
  check('v47: a name-mismatched member still SEES a delegated task (fail open)', vis.mismatch === true);
  const rosteredHidden = await C.evaluate(() => {
    // now I'm Emile (in the roster) but the task is assigned only to lulu → hidden (correct)
    return visibleToMe({space:'hh-fam', assignees:['lulu'], createdBy:'chris'});
  });
  check('v47: a correctly-rostered, unassigned member does NOT see it (still targeted)', rosteredHidden === false);

  // ---------- 4. past-tense speech doesn't create open tasks ----------
  const tasks = await A.evaluate(() => {
    const r = localSummarize('I already emailed the accountant and I need to call the dentist tomorrow');
    return r.tasks.map(t => t.text.toLowerCase());
  });
  check('v47: "need to call the dentist" becomes a task', tasks.some(t => /dentist|call/.test(t)));
  check('v47: "already emailed the accountant" does NOT become a task',
    !tasks.some(t => /email|accountant/.test(t)));

  // ---------- 5. setup checklist stays open on a step tap ----------
  const D = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
  });
  await D.evaluate(() => guideSpaceSetup(spacesList()[0]));
  await D.waitForTimeout(150);
  check('v47: setup sheet is shown', await D.locator('#setupSheet').isVisible());
  const stepCount = await D.locator('#setupSteps .setup-step').count();
  // tap the "People" step (opens a prompt, which we auto-dismiss)
  D.on('dialog', dlg => dlg.dismiss());
  await D.locator('#setupSteps .setup-step').last().click();
  await D.waitForTimeout(150);
  check('v47: setup sheet STAYS OPEN after tapping a step', await D.locator('#setupSheet').isVisible());
  check('v47: all steps still present (not self-destructed)',
    await D.locator('#setupSteps .setup-step').count() === stepCount);

  // ---------- 6. Escape doesn't finalize first-run onboarding ----------
  const E = await mk(() => { /* fresh: no onboarded flag → first run */ });
  check('v47: onboarding shows on first run', await E.locator('#onboarding').isVisible());
  await E.keyboard.press('Escape');
  await E.waitForTimeout(150);
  check('v47: Escape hides onboarding', !(await E.locator('#onboarding').isVisible()));
  check('v47: but does NOT mark onboarded (walkthrough returns next launch)',
    await E.evaluate(() => store.get('onboarded', false) === false));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
