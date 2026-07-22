// v99: AI refresh — a capture structured by the built-in engine (AI down,
// quota hit) can be re-processed once AI is back. REPLACE policy: un-done
// first-pass tasks are removed (tombstoned in shared records) and the AI
// versions take their place; done tasks stay as records; the refresh lands in
// the record; the note is flagged re-processed. A failed retry costs nothing.
const { chromium } = require('playwright');

const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1', aiProxy:'https://proxy.example/ai'};`;
const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_AUTH = `
  export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
  export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
  export async function signInAnonymously(a){ a.currentUser={uid:'u1', getIdToken: async()=>'TOKEN-123'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
const FAKE_FS = `
  export function initializeFirestore(){ return {}; }
  export function persistentLocalCache(){ return {}; }
  export function collection(db,...p){ return {path:p.join('/')}; }
  export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
  export async function setDoc(){} export async function deleteDoc(){}
  export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
  export function onSnapshot(col,cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;
// the AI splits differently from the built-in engine: richer wording + an extra task
const AI_RESULT = {summary: 'Dentist + dry cleaning', priority: 'medium', tasks: [
  {text: 'Book the dentist appointment', priority: 'high', tags: ['health'], date: null},
  {text: 'Pick up the dry cleaning', priority: 'medium', tags: ['errands']},
  {text: 'Check the dental insurance cover', priority: 'low', tags: ['admin']}]};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n + (c ? '' : ' — ' + (extra || ''))); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: opts.managed === false ? 'window.MANAGED=null;' : MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const state = { quota: opts.quota != null ? opts.quota : 999 };
    await ctx.route('https://proxy.example/**', async route => {
      if (state.quota <= 0){ await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({error:{message:'daily AI limit reached'}}) }); return; }
      state.quota--;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{content: {parts: [{text: JSON.stringify(AI_RESULT)}]}}] }) });
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { localStorage.setItem('onboarded', 'true'); localStorage.setItem('myName', JSON.stringify('Alex')); });
    if (opts.init) await p.addInitScript(opts.init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return { p, state };
  };

  // ---------- 1. capture with AI down → built-in + retry chip ----------
  const { p: A, state: stA } = await mk({ quota: 0,
    init: () => localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-fam', name: 'Home', type: 'family', cfg: null, managed: true}])) });
  await A.evaluate(() => { captureDest = 'hh-fam'; });
  await A.fill('#liveText', 'book the dentist and pick up the dry cleaning');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(900);
  check('AI-down capture lands via the built-in engine',
    await A.evaluate(() => ideas[0].engine === 'built-in'));
  const firstIds = await A.evaluate(() => todos.filter(td => td.ideaId === ideas[0].id).map(td => td.id));
  check('the built-in split produced linked tasks in the space', firstIds.length >= 2 &&
    await A.evaluate(() => todos.every(td => td.space === 'hh-fam')), JSON.stringify(firstIds));
  await A.click('nav.tabs button[data-view="ideas"]');
  await A.waitForTimeout(300);
  check('the note card offers “retry with AI”',
    await A.locator('.card .retry-ai').count() === 1 &&
    /retry with AI/.test(await A.locator('.card .retry-ai').textContent()));

  // ---------- 2. tick one task, revive AI, retry → replace policy ----------
  await A.evaluate(() => {
    const td = todos.find(x => /dentist/i.test(x.text));
    td.done = true; td.doneAt = Date.now(); logEvent('ticked', td); saveTodos();
  });
  await A.evaluate(() => { /* quota back */ });
  stA.quota = 999;
  await A.click('.card .retry-ai');
  await A.waitForTimeout(900);
  const after = await A.evaluate(() => ({
    engine: ideas[0].engine, reprocessed: ideas[0].reprocessed, retries: ideas[0].retries,
    linked: todos.filter(td => td.ideaId === ideas[0].id).map(td => ({id: td.id, text: td.text, done: td.done, space: td.space})),
    events: JSON.parse(localStorage.getItem('events')).map(e => ({kind: e.kind, text: e.text}))
  }));
  check('the note is re-processed and flagged', after.engine === 'ai' && after.reprocessed === true && after.retries === 1);
  check('done first-pass task stays as a record',
    after.linked.some(t => t.done && /dentist/i.test(t.text)), JSON.stringify(after.linked));
  check('un-done first-pass tasks are REPLACED by the AI versions', (() => {
    const undone = after.linked.filter(t => !t.done);
    return undone.every(t => /-r1-/.test(t.id)) &&
      undone.some(t => t.text === 'Pick up the dry cleaning') &&
      undone.some(t => t.text === 'Check the dental insurance cover');
  })(), JSON.stringify(after.linked));
  check('the done task is not re-added as new work',
    after.linked.filter(t => /dentist/i.test(t.text)).length === 1, JSON.stringify(after.linked));
  check('retry task ids never collide with first-pass ids', (() => {
    const ids = after.linked.map(t => t.id);
    return new Set(ids).size === ids.length;
  })());
  check('replaced tasks are tombstoned in the record with the reason',
    after.events.some(e => e.kind === 'deleted'), JSON.stringify(after.events.map(e => e.kind)));
  check('the refresh itself lands in the record',
    after.events.some(e => e.kind === 'refreshed'), JSON.stringify(after.events.map(e => e.kind)));
  check('the new tasks land in the original space',
    after.linked.filter(t => !t.done).every(t => t.space === 'hh-fam'), JSON.stringify(after.linked));
  check('the toast tells the replace story',
    /Re-processed with AI/.test(await A.locator('#toast').textContent()) &&
    /done kept/.test(await A.locator('#toast').textContent()),
    await A.locator('#toast').textContent());
  await A.waitForTimeout(200);
  check('the chip now reads ai · re-processed and the retry chip is gone',
    /re-processed/.test(await A.locator('.card .chip', {hasText: 'ai'}).first().textContent()) &&
    await A.locator('.card .retry-ai').count() === 0);
  check('history renders the refresh line', await A.evaluate(async () => {
    await openHistory(spacesList()[0]);
    return /re-processed a capture with AI/.test(document.getElementById('histList').textContent);
  }));

  // ---------- 3. retry while AI is still down → nothing lost ----------
  const { p: B } = await mk({ quota: 0 });
  await B.fill('#liveText', 'water the plants and feed the cat');
  await B.click('#saveIdeaBtn');
  await B.waitForTimeout(900);
  const beforeRetry = await B.evaluate(() => todos.map(td => td.id));
  await B.click('nav.tabs button[data-view="ideas"]');
  await B.waitForTimeout(300);
  await B.click('.card .retry-ai');
  await B.waitForTimeout(900);
  check('a failed retry keeps every task untouched', await B.evaluate((ids) =>
    JSON.stringify(todos.map(td => td.id)) === JSON.stringify(ids) && ideas[0].engine === 'built-in' && !ideas[0].reprocessed,
    beforeRetry));
  check('the failed retry is recorded as a fallback with where=retry', await B.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('aiLastFallback'));
    return f && f.where === 'retry' && /daily AI limit/.test(f.reason);
  }));
  check('and the toast says tasks are unchanged',
    /Still no AI/.test(await B.locator('#toast').textContent()) &&
    /unchanged/.test(await B.locator('#toast').textContent()),
    await B.locator('#toast').textContent());
  check('the retry chip stays for another go', await B.locator('.card .retry-ai').count() === 1);

  // ---------- 4. no AI configured at all → no retry chip ----------
  const { p: C } = await mk({ managed: false });
  await C.fill('#liveText', 'buy milk and bread');
  await C.click('#saveIdeaBtn');
  await C.waitForTimeout(700);
  await C.click('nav.tabs button[data-view="ideas"]');
  await C.waitForTimeout(300);
  check('no AI configured → built-in engine, no retry chip',
    await C.evaluate(() => ideas[0].engine === 'built-in') &&
    await C.locator('.card .retry-ai').count() === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
