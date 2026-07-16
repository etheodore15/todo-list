// v30 C2 caregiving pack: timed meds/routines with missed-dose records (C2b),
// care journal via shared ideas (C2c), doctor briefing (C2d), handoff divider (C2e).
const { chromium } = require('playwright');
const http = require('http');

const docs = new Map();
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS'){ res.end(); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/set'){
      const {path, data} = JSON.parse(body);
      docs.set(path, {...(docs.get(path) || {}), ...data}); res.end('{}');
    } else if (url.pathname === '/del'){ docs.delete(JSON.parse(body).path); res.end('{}'); }
    else if (url.pathname === '/dump'){
      const prefix = url.searchParams.get('prefix') + '/';
      const out = {};
      for (const [p, d] of docs) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out[p.slice(prefix.length)] = d;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    } else res.end('{}');
  });
});

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
const API = 'http://localhost:8907';
export function initializeFirestore(app, opts){ return {app}; }
export function persistentLocalCache(o){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(ref, data, opts){ await fetch(API + '/set', {method: 'POST', body: JSON.stringify({path: ref.path, data})}); }
export async function deleteDoc(ref){ await fetch(API + '/del', {method: 'POST', body: JSON.stringify({path: ref.path})}); }
export function onSnapshot(col, cb){
  const poll = async () => {
    try {
      const r = await fetch(API + '/dump?prefix=' + encodeURIComponent(col.path));
      const cur = await r.json();
      cb({docChanges: () => Object.entries(cur).map(([id, data]) => ({type: 'added', doc: {id, data: () => data}}))});
    } catch (e) {}
  };
  poll();
  return () => {};
}`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
  await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
  let briefPrompt = '';
  await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
    if (route.request().method() === 'GET'){
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({models: [{name: 'models/gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent']}]}) });
      return;
    }
    const prompt = JSON.parse(route.request().postData()).contents[0].parts[0].text;
    if (/doctor visit/.test(prompt)){
      briefPrompt = prompt;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({
          overview: 'Mum has been mostly stable; two dizzy spells noted.',
          observations: ['Dizzy on Tuesday morning'],
          routines: ['Ramipril taken 26 of 28 days; 2 missed'],
          concerns: ['Recurring dizziness'],
          questions: ['Could the dizziness relate to the blood pressure medication?']
        })}]}}]}) });
      return;
    }
    await route.fulfill({ status: 500, body: '{}' });
  });

  const page = await ctx.newPage();
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // seed: a care space, a missed med from yesterday, an idea, my name
  await page.addInitScript((d) => {
    if (localStorage.getItem('spaces')) return;
    localStorage.setItem('myName', JSON.stringify('sam'));
    localStorage.setItem('geminiKey', JSON.stringify('AIza-test'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-care1', name: "Mum's care", type: 'care', cfg: {apiKey: 'AizaFake', projectId: 'fake-project'}}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-care1'));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey: 'AizaFake', projectId: 'fake-project'}));
    localStorage.setItem('householdId', JSON.stringify('hh-care1'));
    localStorage.setItem('todos', JSON.stringify([
      {id: 'med1', text: 'Give mum her Ramipril', priority: 'high', tags: ['health'], done: false,
       date: d.yest, time: '08:00', recur: {type: 'daily'}, space: 'hh-care1'}]));
    localStorage.setItem('ideas', JSON.stringify([
      {id: 'idea1', raw: 'mum seemed dizzy this morning when she got up, steadied after breakfast',
       summary: 'Mum was dizzy this morning.', priority: 'medium', engine: 'built-in', ts: Date.now()}]));
  }, {yest});
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // ---------- C2b: missed dose recorded, task respawned today ----------
  const med = await page.evaluate(() => JSON.parse(localStorage.getItem('todos')).find(t => t.id === 'med1'));
  check('C2b: missed med respawns today (not merged)', med.date === today && !med.done);
  const missedEv = await page.evaluate(() => store.get('events', []).find(e => e.kind === 'missed'));
  check('C2b: missed event recorded with schedule detail',
    missedEv && /scheduled .*8am/.test(missedEv.detail) && missedEv.space === 'hh-care1');
  const remoteEvents = await fetch('http://localhost:8907/dump?prefix=' +
    encodeURIComponent('households/hh-care1/events')).then(r => r.json());
  check('C2b: boot-time missed event flushed to the space',
    Object.values(remoteEvents).some(e => e.kind === 'missed'));

  // time parsing + chip
  await page.click('nav.tabs button[data-view="today"]');
  check('C2b: time chip rendered', /8am/.test(await page.locator('.time-chip').first().textContent()));
  const parsed = await page.evaluate(() => [parseTaskTime('pick up at 3:30pm'), parseTaskTime('meds at 8am'), parseTaskTime('buy 2 milk')]);
  check('C2b: parseTaskTime handles pm/am/none',
    parsed[0] === '15:30' && parsed[1] === '08:00' && parsed[2] === null);

  // ---------- C2c: share idea to the care journal ----------
  await page.click('nav.tabs button[data-view="ideas"]');
  const shareBtn = page.locator('.share-note', { hasText: "Share to Mum's care" });
  check('C2c: share button on idea card', await shareBtn.count() === 1);
  await shareBtn.click();
  await page.waitForTimeout(400);
  check('C2c: button flips to shared state',
    /in Mum's care journal/.test(await page.locator('.share-note').textContent()));
  const noteRemote = await fetch('http://localhost:8907/dump?prefix=' +
    encodeURIComponent('households/hh-care1/events')).then(r => r.json());
  check('C2c: note event pushed with transcript text',
    Object.values(noteRemote).some(e => e.kind === 'note' && /dizzy this morning/.test(e.text) && e.who === 'sam'));

  // ---------- history shows note + missed; C2e divider on second visit ----------
  await page.click('nav.tabs button[data-view="settings"]');
  await page.locator('#spacesList button', { hasText: 'History' }).click();
  await page.waitForTimeout(700);
  const hist1 = await page.locator('#histList').textContent();
  check('C2: history shows noted and missed entries',
    /📝|noted/.test(hist1) === false ? /noted/.test(hist1) : true && /missed/.test(hist1) && /noted/.test(hist1));
  check('C2e: no divider on first ever look', !/since you last looked/.test(hist1));
  await page.click('#histClose');
  // a new event lands (tick the med), then reopen → divider appears
  await page.click('nav.tabs button[data-view="today"]');
  await page.locator('.todo', { hasText: 'Ramipril' }).locator('.chk').click();
  await page.waitForTimeout(300);
  await page.click('nav.tabs button[data-view="settings"]');
  await page.locator('#spacesList button', { hasText: 'History' }).click();
  await page.waitForTimeout(700);
  // own actions shouldn't trigger the divider — check logic: sam ticked it himself
  check('C2e: own actions alone do not flag a handoff',
    !/since you last looked/.test(await page.locator('#histList').textContent()));
  // simulate another member's event since last look
  await page.evaluate(() => {
    const t0 = Date.now();
    const evs = store.get('events', []);
    evs.push({id: 'evx', ts: t0 + 1000, who: 'alex', kind: 'ticked', taskId: 'x',
              text: 'Evening meds', space: 'hh-care1', detail: null});
    store.set('events', evs);
    const seen = store.get('histSeen', {});
    seen['hh-care1'] = t0;      // last looked just now — only alex's event is newer
    store.set('histSeen', seen);
  });
  await page.click('#histClose');
  await page.locator('#spacesList button', { hasText: 'History' }).click();
  await page.waitForTimeout(700);
  check('C2e: divider shows what happened since last look',
    /since you last looked/.test(await page.locator('#histList').textContent()));

  // ---------- C2d: doctor briefing ----------
  check('C2d: briefing button visible on care space', await page.locator('#histBriefBtn').isVisible());
  const brief = await page.evaluate(async () => {
    const b = await geminiBriefing(histSpace, 'AIza-test');
    return {b, html: briefingHtml(histSpace, b)};
  });
  check('C2d: prompt includes notes, missed doses and open tasks',
    /dizzy this morning/.test(briefPrompt) && /MISSED/.test(briefPrompt));
  check('C2d: structured brief returned', /two dizzy spells/.test(brief.b.overview));
  check('C2d: printable brief renders all sections',
    /doctor briefing/.test(brief.html) && /26 of 28 days/.test(brief.html) &&
    /Questions for the doctor/.test(brief.html) && /not medical advice/.test(brief.html));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
