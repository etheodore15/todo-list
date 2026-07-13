// v28 C1a/C1b: append-only audit log per space + CSV export.
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
      docs.set(path, {...(docs.get(path) || {}), ...data});
      res.end('{}');
    } else if (url.pathname === '/del'){
      docs.delete(JSON.parse(body).path); res.end('{}');
    } else if (url.pathname === '/dump'){
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

  const mkDevice = async (name) => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
    await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
    if (name){
      await page.click('nav.tabs button[data-view="settings"]');
      await page.fill('#myNameInput', name);
      await page.click('#saveMyNameBtn');
    }
    return page;
  };

  // ---------- A: set name, create a co-parenting space, act on tasks ----------
  const A = await mkDevice('alex');
  await A.click('#syncSetup summary');
  await A.fill('#fbConfigInput', 'const firebaseConfig = { apiKey: "AizaFake", projectId: "fake-project" };');
  await A.fill('#spaceNameInput', 'Co-parenting');
  await A.selectOption('#spaceTypeSel', 'coparenting');
  await A.click('#createHhBtn');
  await A.waitForTimeout(800);
  await A.click('#setupDone');  // v43: dismiss the guided-setup checklist
  await A.waitForTimeout(100);

  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'pack the school bag');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(300);

  // edit
  const bag = A.locator('.todo', { hasText: 'pack the school bag' });
  await bag.locator('.ttext').click();
  A.once('dialog', d => d.accept('pack the school bag and lunchbox'));
  await bag.locator('.tact', { hasText: 'Edit' }).click();
  await A.waitForTimeout(200);
  // tick
  await A.locator('.todo', { hasText: 'lunchbox' }).locator('.chk').click();
  await A.waitForTimeout(300);
  // second task, then delete it (tombstone)
  await A.fill('#quickAdd', 'book the parent teacher meeting');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(200);
  await A.locator('.todo', { hasText: 'parent teacher' }).locator('.del').click();
  await A.waitForTimeout(400);

  const localEvents = await A.evaluate(() => store.get('events', []).map(e => e.kind));
  check('C1a: all action kinds logged locally',
    ['created', 'edited', 'ticked', 'deleted'].every(k => localEvents.includes(k)));

  const hid = await A.evaluate(() => store.get('spaces')[0].hid);
  const remoteEvents = await fetch('http://localhost:8907/dump?prefix=' +
    encodeURIComponent(`households/${hid}/events`)).then(r => r.json());
  const kinds = Object.values(remoteEvents).map(e => e.kind);
  check('C1a: events pushed to the space (incl. delete tombstone)',
    kinds.includes('created') && kinds.includes('edited') && kinds.includes('deleted'));
  check('C1a: events carry who + task text',
    Object.values(remoteEvents).every(e => e.who === 'alex' && e.text));
  check('C1a: edit records prior text',
    Object.values(remoteEvents).some(e => e.kind === 'edited' && /was: "pack the school bag"/.test(e.detail)));

  // ---------- history overlay on A ----------
  await A.click('nav.tabs button[data-view="settings"]');
  await A.locator('#spacesList button', { hasText: 'History' }).click();
  await A.waitForTimeout(600);
  const histText = await A.locator('#histList').textContent();
  check('C1a: history lists actions with attribution',
    /alex/.test(histText) && /ticked off/.test(histText) && /deleted/.test(histText));
  check('C1a: history explains append-only',
    /can't be edited or removed/.test(await A.locator('#histOverlay').textContent()));

  // ---------- CSV export ----------
  const csv = await A.evaluate(() => auditCsv(histEvents, histSpace.name));
  const lines = csv.split('\n');
  check('C1b: CSV has header + one row per event',
    lines[0] === 'timestamp,date,time,who,action,task,detail' && lines.length >= 6);
  check('C1b: CSV escapes quoted text',
    /"was: ""pack the school bag"""/.test(csv));
  await A.click('#histClose');

  // ---------- B joins and sees the same history (remote merge) ----------
  const inv = await A.evaluate(() => {
    const sp = store.get('spaces')[0];
    return inviteEncode(sp.cfg, sp.hid, sp.name, sp.type);
  });
  const B = await mkDevice('sam');
  await B.fill('#inviteInput', inv);
  await B.click('#joinBtn');
  await B.waitForTimeout(1000);
  await B.locator('#spacesList button', { hasText: 'History' }).click();
  await B.waitForTimeout(800);
  const histB = await B.locator('#histList').textContent();
  check('C1a: joining device sees the full remote history',
    /alex/.test(histB) && /deleted/.test(histB) && /pack the school bag/.test(histB));

  // B ticks something → A's history shows sam
  await B.click('#histClose');
  await B.click('nav.tabs button[data-view="today"]');
  await B.locator('.todo', { hasText: 'lunchbox' }).locator('.chk').click(); // untick actually (was done)
  await B.waitForTimeout(500);
  await A.click('nav.tabs button[data-view="settings"]');
  await A.locator('#spacesList button', { hasText: 'History' }).click();
  await A.waitForTimeout(800);
  check('C1a: other member\'s action attributed in my history',
    /sam/.test(await A.locator('#histList').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
