// v27 A6 multiple spaces: two spaces on one device, per-space sync isolation,
// space switcher, moving tasks between spaces, personal tasks, migration.
const { chromium } = require('playwright');
const http = require('http');

// in-memory Firestore stub (same protocol as test_sync/test_family_sync)
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

  const mkDevice = async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
    return page;
  };

  // ---------- device A: create two spaces ----------
  const A = await mkDevice();
  await A.click('nav.tabs button[data-view="settings"]');
  await A.click('#syncSetup summary');
  await A.fill('#fbConfigInput', 'const firebaseConfig = { apiKey: "AizaFake", projectId: "fake-project" };');
  await A.fill('#spaceNameInput', 'Home');
  await A.click('#createHhBtn');
  await A.waitForTimeout(800);
  check('A: first space created', /Sync active|1 space|spaces syncing/i.test(await A.locator('#syncMsg').textContent()));

  // second space (care team) reusing the same project — the details element
  // is still open from the first create, so no summary click needed
  await A.click('#addSpaceBtn');
  await A.fill('#fbConfigInput', 'const firebaseConfig = { apiKey: "AizaFake", projectId: "fake-project" };');
  await A.fill('#spaceNameInput', "Mum's care");
  await A.selectOption('#spaceTypeSel', 'care');
  await A.click('#createHhBtn');
  await A.waitForTimeout(800);
  const spacesA = await A.evaluate(() => store.get('spaces'));
  check('A: two spaces stored', spacesA.length === 2 && spacesA[1].type === 'care');
  check('A: settings lists both spaces',
    /Home/.test(await A.locator('#spacesList').textContent()) &&
    /Mum's care/.test(await A.locator('#spacesList').textContent()));

  // ---------- add tasks into different spaces via the switcher ----------
  await A.click('nav.tabs button[data-view="today"]');
  check('A: space switcher rendered', await A.locator('#spaceFilter .fchip').count() === 4); // All, Home, care, Personal

  // task in Home (default space = first)
  await A.fill('#quickAdd', 'buy milk');
  await A.click('#quickAddBtn');
  // switch to care space → task lands there
  await A.locator('#spaceFilter .fchip', { hasText: "Mum's care" }).click();
  await A.fill('#quickAdd', 'pick up prescriptions');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(600);
  check('A: care view shows only its task',
    (await A.locator('#todoList .ttext').allTextContents()).join() === 'pick up prescriptions');
  // personal task never syncs
  await A.locator('#spaceFilter .fchip', { hasText: 'Personal' }).click();
  await A.fill('#quickAdd', 'secret gift for lulu');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(600);
  await A.locator('#spaceFilter .fchip', { hasText: 'All' }).click();
  check('A: All view shows all three',
    (await A.locator('#todoList .ttext').allTextContents()).length === 3);

  const spaceTasks = await A.evaluate(() => JSON.parse(localStorage.getItem('todos'))
    .map(t => ({text: t.text, space: t.space || null})));
  const homeHid = spacesA[0].hid, careHid = spacesA[1].hid;
  check('A: tasks keyed to the right spaces',
    spaceTasks.find(t => /milk/.test(t.text)).space === homeHid &&
    spaceTasks.find(t => /prescriptions/.test(t.text)).space === careHid &&
    spaceTasks.find(t => /secret/.test(t.text)).space === null);

  // ---------- device B: joins ONLY the care space ----------
  const inviteCare = await A.evaluate((hid) => {
    const sp = store.get('spaces').find(s => s.hid === hid);
    return inviteEncode(sp.cfg, sp.hid, sp.name, sp.type);
  }, careHid);
  const B = await mkDevice();
  await B.click('nav.tabs button[data-view="settings"]');
  await B.fill('#inviteInput', inviteCare);
  await B.click('#joinBtn');
  await B.waitForTimeout(1000);
  const spacesB = await B.evaluate(() => store.get('spaces'));
  check('B: joined care space with name+type from invite',
    spacesB.length === 1 && spacesB[0].name === "Mum's care" && spacesB[0].type === 'care');
  await B.click('nav.tabs button[data-view="today"]');
  const textsB = await B.locator('#todoList .ttext').allTextContents();
  check('B: sees the care task', textsB.some(t => /prescriptions/.test(t)));
  check('B: does NOT see Home or personal tasks',
    !textsB.some(t => /milk|secret/.test(t)));

  // B ticks the care task → A sees it done
  await B.locator('.todo', { hasText: 'prescriptions' }).locator('.chk').click();
  await A.waitForTimeout(1200);
  check('A: care tick syncs back',
    await A.locator('.todo.done', { hasText: 'prescriptions' }).count() === 1);

  // ---------- move a task between spaces ----------
  await A.locator('.todo', { hasText: 'buy milk' }).locator('.scope-chip').click();
  await A.locator('#scopeSpaces button', { hasText: "Mum's care" }).click();
  await A.waitForTimeout(1200);
  const textsB2 = await B.locator('#todoList .ttext').allTextContents();
  check('B: task moved into care space appears', textsB2.some(t => /milk/.test(t)));
  const remoteHome = await fetch('http://localhost:8907/dump?prefix=' + encodeURIComponent(`households/${homeHid}/items`)).then(r => r.json());
  check('remote: task removed from old space', !Object.keys(remoteHome).length ||
    !Object.values(remoteHome).some(d => /milk/.test(d.text)));

  // ---------- scope label shows space name when several spaces ----------
  const label = await A.locator('.todo', { hasText: 'secret gift' }).locator('.scope-chip').textContent();
  check('A: personal task labelled private', /private/.test(label));

  // ---------- migration from single-household model ----------
  const C = await (async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    await page.addInitScript((hid) => {
      if (localStorage.getItem('spaces')) return;
      localStorage.setItem('fbConfig', JSON.stringify({apiKey: 'AizaFake', projectId: 'fake-project'}));
      localStorage.setItem('householdId', JSON.stringify(hid));
      localStorage.setItem('todos', JSON.stringify([
        {id: 'old1', text: 'legacy shared task', priority: 'medium', tags: ['general'], done: false,
         date: new Date().toISOString().slice(0, 10)},
        {id: 'old2', text: 'legacy private task', priority: 'low', tags: ['general'], done: false,
         scope: 'private', date: new Date().toISOString().slice(0, 10)}
      ]));
    }, careHid);
    page.on('pageerror', e => errors.push(e.message));
    // sync starts at boot on this device, so the network never goes idle
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    return page;
  })();
  await C.waitForTimeout(800);
  const migrated = await C.evaluate(() => ({
    spaces: store.get('spaces'),
    tasks: JSON.parse(localStorage.getItem('todos')).map(t => ({id: t.id, space: t.space || null}))
  }));
  check('C: legacy household became a space',
    migrated.spaces.length === 1 && migrated.spaces[0].name === 'Family');
  check('C: legacy tasks adopted, private stayed local',
    migrated.tasks.find(t => t.id === 'old1').space === migrated.spaces[0].hid &&
    migrated.tasks.find(t => t.id === 'old2').space === null);
  await C.click('nav.tabs button[data-view="today"]');
  const textsC = await C.locator('#todoList .ttext').allTextContents();
  check('C: migrated device sees care-space tasks', textsC.some(t => /prescriptions/.test(t)));

  // ---------- leaving one space keeps the other ----------
  await A.click('nav.tabs button[data-view="settings"]');
  A.once('dialog', d => d.accept());
  await A.locator('#spacesList .space-row', { hasText: "Mum's care" }).locator('button', { hasText: 'Leave' }).click();
  await A.waitForTimeout(500);
  const afterLeave = await A.evaluate(() => ({
    spaces: store.get('spaces'),
    milk: JSON.parse(localStorage.getItem('todos')).find(t => /milk/.test(t.text))
  }));
  check('A: one space left, Home remains', afterLeave.spaces.length === 1 && afterLeave.spaces[0].name === 'Home');
  check('A: left space\'s tasks kept as personal', afterLeave.milk && (afterLeave.milk.space || null) === null);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
