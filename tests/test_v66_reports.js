// v66: report framework.
// - The doctor briefing (and every report) opens the overlay IMMEDIATELY with
//   a loading state; content swaps in when composed.
// - Per-cohort reports: ADHD/personal "My week in review" (completions, effort,
//   trend, kind framing), family "Week report" (who did what, coming up),
//   co-parenting "Records summary" (expenses, net owed, neutral wording).
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

  const HOUR = 3600000, DAY = 86400000;
  const mk = async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      const DAY = 86400000, now = Date.now();
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('myName', JSON.stringify('Alex'));
      localStorage.setItem('spaces', JSON.stringify([
        {hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}},
        {hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}},
        {hid:'hh-cop', name:'Kids', type:'coparenting', cfg:{apiKey:'k',projectId:'p'}}]));
      const t = new Date().toISOString().slice(0,10);
      localStorage.setItem('todos', JSON.stringify([
        // personal, done this week (high effort) + one last week for the trend
        {id:'p1', text:'Renew the car registration', priority:'high', tags:['car'], done:true,
         date:t, doneAt: now - 2*DAY, energy:'high', minutes:60},
        {id:'p2', text:'Water the plants', priority:'low', tags:['home'], done:true,
         date:t, doneAt: now - 1*DAY, energy:'low', minutes:10},
        {id:'p0', text:'Old win', priority:'low', tags:[], done:true, date:t, doneAt: now - 9*DAY, minutes:10},
        // family space
        {id:'f1', text:'Take the bins out', priority:'low', tags:[], done:true, date:t,
         doneAt: now - 1*DAY, space:'hh-fam', doneBy:'Lulu'},
        {id:'f2', text:'Book swimming lessons', priority:'medium', tags:[], done:false,
         date: new Date(now + 3*DAY).toISOString().slice(0,10), space:'hh-fam'},
        // co-parenting with expenses by both parents
        {id:'c1', text:'School shoes', priority:'medium', tags:[], done:true, date:t,
         doneAt: now - 2*DAY, space:'hh-cop', doneBy:'Alex', amount:120, expenseBy:'Alex', expenseAt: now - 2*DAY},
        {id:'c2', text:'Excursion fee', priority:'medium', tags:[], done:true, date:t,
         doneAt: now - 3*DAY, space:'hh-cop', doneBy:'Sam', amount:40, expenseBy:'Sam', expenseAt: now - 3*DAY}]));
      localStorage.setItem('events', JSON.stringify([
        {id:'e1', kind:'note', space:'hh-care', who:'Alex', ts: now - 3600000, text:'Ate well, tired after physio'},
        {id:'e2', kind:'created', space:'hh-fam', who:'Emile', ts: now - 2*DAY, text:'Take the bins out'}]));
    });
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- 1. briefing opens INSTANTLY with a loading state ----------
  const A = await mk();
  await A.evaluate(() => {
    store.set('geminiKey', 'fake');            // aiEnabled → true so compose is slow
    window.geminiBriefing = () => new Promise(res => setTimeout(() =>
      res({overview: 'Margaret had a steady month.', observations: ['Ate well'], routines: [], concerns: [], questions: []}), 800));
  });
  await A.evaluate(() => openHistory(spacesList()[0]));
  await A.waitForTimeout(300);
  await A.click('#histBriefBtn');
  await A.waitForTimeout(150);                 // well before the 800ms compose
  check('v66: overlay opens immediately on click', await A.locator('#briefOverlay').isVisible());
  check('v66: loading state shows while composing',
    /Reading 4 weeks|composing/i.test(await A.locator('#briefBody').textContent()));
  check('v66: print disabled during composition',
    await A.evaluate(() => document.getElementById('briefPrint').disabled === true));
  await A.waitForTimeout(1100);
  check('v66: composed brief replaces the loader',
    /steady month/.test(await A.locator('#briefBody').textContent()));
  check('v66: print re-enabled once ready',
    await A.evaluate(() => document.getElementById('briefPrint').disabled === false));

  // ---------- 2. ADHD/personal week in review ----------
  const B = await mk();
  await B.click('nav.tabs button[data-view="today"]');
  await B.waitForTimeout(300);
  await B.evaluate(() => openReflection());
  await B.waitForTimeout(400);
  const refl = await B.locator('#briefBody').textContent();
  // p1 (60m) + p2 (10m) + c1 (ticked by Alex, default 25m) = 3 of MY tasks, 95m;
  // Lulu's and Sam's ticks must NOT count toward my personal week
  check('v66: reflection shows MY completions + effort (not others\')',
    /3 tasks finished/.test(refl) && /1h 35m/.test(refl) && !/5 tasks/.test(refl));
  check('v66: reflection celebrates high-effort work', /counts double/.test(refl));
  check('v66: reflection shows a trend vs the prior week', /more|quieter/i.test(refl));
  check('v66: reflection lists what was finished', /Renew the car registration/.test(refl));

  // ---------- 3. family week report ----------
  await B.evaluate(() => { document.getElementById('briefOverlay').style.display='none'; openFamilyReport(spacesList().find(s=>s.type==='family')); });
  await B.waitForTimeout(400);
  const fam = await B.locator('#briefBody').textContent();
  check('v66: family report counts the week', /finished 1 task/.test(fam));
  check('v66: family report shows who did what', /Lulu ticked off 1/.test(fam));
  check('v66: family report shows who added what', /Emile added 1/.test(fam));
  check('v66: family report shows what is coming up', /Book swimming lessons/.test(fam));

  // ---------- 4. co-parenting records summary ----------
  await B.evaluate(() => { document.getElementById('briefOverlay').style.display='none'; openCoparentReport(spacesList().find(s=>s.type==='coparenting')); });
  await B.waitForTimeout(400);
  const cop = await B.locator('#briefBody').textContent();
  check('v66: summary totals the expenses', /\$160\.00/.test(cop));
  check('v66: summary shows per-parent spending', /Alex paid \$120\.00/.test(cop) && /Sam paid \$40\.00/.test(cop));
  check('v66: summary computes the 50/50 balance', /Sam owes Alex \$40\.00/.test(cop));
  check('v66: summary counts completions per parent', /Alex: 1/.test(cop) && /Sam: 1/.test(cop));

  // ---------- 5. space bars expose the new reports ----------
  const famActs = await B.evaluate(() => SPACE_ACTIONS.family.map(a => a[1]));
  const copActs = await B.evaluate(() => SPACE_ACTIONS.coparenting.map(a => a[1]));
  check('v66: family space bar offers the week report', famActs.includes('Week report'));
  check('v66: co-parenting space bar offers the summary', copActs.includes('Records summary'));
  check('v66: wins block offers the personal reflection',
    await B.evaluate(() => !!document.getElementById('reflectBtn')));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
