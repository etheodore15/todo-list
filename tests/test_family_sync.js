const { chromium } = require('playwright');
const http = require('http');

// Two isolated browser contexts ("two phones") syncing through an in-memory
// Firestore stub that implements the exact SDK surface the app uses.
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
      docs.set(path, {...(docs.get(path) || {}), ...data});
      res.end('{}');
    } else if (url.pathname === '/del'){
      docs.delete(JSON.parse(body).path);
      res.end('{}');
    } else if (url.pathname === '/dump'){
      const prefix = url.searchParams.get('prefix') + '/';
      const out = {};
      for (const [p, d] of docs) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out[p.slice(prefix.length)] = d;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    } else res.end('{}');
  });
});

const FAKE_APP = `export function initializeApp(cfg){ return {cfg}; }`;
const FAKE_FS = `
const API = 'http://localhost:8907';
export function initializeFirestore(app, opts){ return {app}; }
export function persistentLocalCache(o){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(ref, data, opts){ await fetch(API + '/set', {method: 'POST', body: JSON.stringify({path: ref.path, data})}); }
export async function deleteDoc(ref){ await fetch(API + '/del', {method: 'POST', body: JSON.stringify({path: ref.path})}); }
export function onSnapshot(col, cb, errCb){
  const known = {};
  let first = true;
  const poll = async () => {
    try {
      const r = await fetch(API + '/dump?prefix=' + encodeURIComponent(col.path));
      const cur = await r.json();
      const changes = [];
      for (const [id, data] of Object.entries(cur)){
        const s = JSON.stringify(data);
        if (!(id in known)) changes.push({type: 'added', doc: {id, data: () => data}});
        else if (known[id] !== s) changes.push({type: 'modified', doc: {id, data: () => data}});
        known[id] = s;
      }
      for (const id of Object.keys(known)){
        if (!(id in cur)){ changes.push({type: 'removed', doc: {id, data: () => ({})}}); delete known[id]; }
      }
      if (changes.length || first) cb({docChanges: () => changes});
      first = false;
    } catch (e) { if (errCb) errCb(e); }
  };
  poll();
  const t = setInterval(poll, 250);
  return () => clearInterval(t);
}`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mkDevice = async () => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
    return page;
  };

  // Device A: create the household
  const A = await mkDevice();
  await A.click('nav.tabs button[data-view="settings"]');
  await A.click('#syncSetup summary');
  await A.fill('#fbConfigInput', 'const firebaseConfig = { apiKey: "AIzaFake123", projectId: "fake-project" };');
  await A.click('#createHhBtn');
  await A.waitForTimeout(800);
  const msgA = await A.locator('#syncMsg').textContent();
  check('A: household created, sync active', /active/.test(msgA));

  // A adds a task before B even joins
  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'buy milk today');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(600);

  const invite = await A.evaluate(() => inviteEncode(store.get('fbConfig'), store.get('householdId')));
  check('invite code generated', /^ITODO1-/.test(invite));

  // Device B: join via invite
  const B = await mkDevice();
  await B.click('nav.tabs button[data-view="settings"]');
  await B.fill('#inviteInput', invite);
  await B.click('#joinBtn');
  await B.waitForTimeout(1000);
  await B.click('nav.tabs button[data-view="today"]');
  let textsB = await B.locator('.todo .ttext').allTextContents();
  check('B: pre-existing task synced down', textsB.some(t => /buy milk/.test(t)));

  // B adds a task → appears on A
  await B.fill('#quickAdd', 'call the plumber');
  await B.click('#quickAddBtn');
  await A.waitForTimeout(1200);
  await A.click('nav.tabs button[data-view="today"]');
  const textsA = await A.locator('.todo .ttext').allTextContents();
  check('A: task added on B appears', textsA.some(t => /call the plumber/.test(t)));

  // B ticks A's task → done state syncs to A
  await B.locator('.todo', { hasText: 'buy milk' }).locator('.chk').click();
  await A.waitForTimeout(1200);
  const doneA = await A.locator('.todo.done .ttext').allTextContents();
  check('A: tick on B syncs', doneA.some(t => /buy milk/.test(t)));

  // A deletes a task → disappears on B
  A.once('dialog', d => d.accept());
  await A.locator('.todo', { hasText: 'call the plumber' }).locator('.del').click();
  await B.waitForTimeout(1200);
  textsB = await B.locator('.todo .ttext').allTextContents();
  check('B: deletion on A syncs', !textsB.some(t => /call the plumber/.test(t)));

  // Ideas stay private: A captures an idea; B's Ideas tab stays empty
  await A.click('nav.tabs button[data-view="capture"]');
  await A.fill('#liveText', 'I need to book the dentist this week');
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(1200);
  await B.click('nav.tabs button[data-view="ideas"]');
  check('B: ideas stay private', (await B.locator('.card').count()) === 0);
  await B.click('nav.tabs button[data-view="today"]');
  textsB = await B.locator('.todo .ttext').allTextContents();
  check('B: but the task from the idea synced', textsB.some(t => /dentist/i.test(t)));

  // B taps the synced task → cross-device transcript note
  await B.locator('.todo', { hasText: 'dentist' }).locator('.ttext').click();
  const tr = await B.locator('.todo .transcript').textContent();
  check('B: cross-device transcript note', /another device/.test(tr));

  // Leave household on B keeps tasks locally
  await B.click('nav.tabs button[data-view="settings"]');
  B.once('dialog', d => d.accept());
  await B.click('#leaveHhBtn');
  await B.waitForTimeout(300);
  await B.click('nav.tabs button[data-view="today"]');
  check('B: leaving keeps local tasks', (await B.locator('.todo').count()) >= 2);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
