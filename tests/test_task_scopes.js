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
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });
    return page;
  };

  // Device A: create the household
  const A = await mkDevice();
  await A.click('nav.tabs button[data-view="settings"]');
  await A.fill('#myNameInput', 'Emile');
  await A.click('#saveMyNameBtn');
  await A.click('#syncSetup summary');
  await A.fill('#fbConfigInput', 'const firebaseConfig = { apiKey: "AIzaFake123", projectId: "fake-project" };');
  await A.click('#createHhBtn');
  await A.waitForTimeout(800);
  await A.click('#setupDone');  // v43: dismiss the guided-setup checklist
  await A.waitForTimeout(100);
  const msgA = await A.locator('#syncMsg').textContent();
  check('A: household created, sync active', /active/.test(msgA));

  // A adds a task before B even joins
  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'buy milk today');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(600);

  const invite = await A.evaluate(() => inviteEncode(store.get('fbConfig'), store.get('householdId')));
  check('invite code generated', /^ITODO1-/.test(invite));

  // Device B (Lulu) and C (Chris) join via invite
  const B = await mkDevice();
  await B.click('nav.tabs button[data-view="settings"]');
  await B.fill('#myNameInput', 'Lulu');
  await B.click('#saveMyNameBtn');
  await B.fill('#inviteInput', invite);
  await B.click('#joinBtn');
  const C = await mkDevice();
  await C.click('nav.tabs button[data-view="settings"]');
  await C.fill('#myNameInput', 'Chris');
  await C.click('#saveMyNameBtn');
  await C.fill('#inviteInput', invite);
  await C.click('#joinBtn');
  await C.waitForTimeout(1000);

  // members list on A so the delegate sheet has checkboxes
  await A.click('nav.tabs button[data-view="settings"]');
  await A.fill('#membersInput', 'Emile, Lulu, Chris');
  await A.click('#saveMembersBtn');

  // --- private task: stays on A only ---
  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'secret gift research');
  await A.click('#quickAddBtn');
  await A.locator('.todo', { hasText: 'secret gift' }).locator('.scope-chip').click();
  await A.click('#scopePrivate');
  await B.waitForTimeout(1500);
  await B.click('nav.tabs button[data-view="today"]');
  let textsB = await B.locator('.todo .ttext').allTextContents();
  check('B: private task never arrives', !textsB.some(t => /secret gift/.test(t)));
  const chipA = await A.locator('.todo', { hasText: 'secret gift' }).locator('.scope-chip').textContent();
  check('A: private chip shown', /private/.test(chipA));

  // --- retrospective: creator flips private → family ---
  await A.locator('.todo', { hasText: 'secret gift' }).locator('.scope-chip').click();
  await A.click('#scopeFamily');
  await B.waitForTimeout(1500);
  textsB = await B.locator('.todo .ttext').allTextContents();
  check('B: re-scoped to family appears', textsB.some(t => /secret gift/.test(t)));

  // --- delegate to one member (Lulu): visible to creator + Lulu, hidden from Chris ---
  await A.fill('#quickAdd', 'return the library books');
  await A.click('#quickAddBtn');
  await A.locator('.todo', { hasText: 'library books' }).locator('.scope-chip').click();
  await A.locator('#scopeMembers input[value="Lulu"]').check();
  await A.click('#scopeAssign');
  await B.waitForTimeout(1500);
  const chipA2 = await A.locator('.todo', { hasText: 'library books' }).locator('.scope-chip').textContent();
  check('A: creator still sees, chip shows → lulu', /→ Lulu/.test(chipA2));
  textsB = await B.locator('.todo .ttext').allTextContents();
  check('B (Lulu): assignee sees the task', textsB.some(t => /library books/.test(t)));
  await C.click('nav.tabs button[data-view="today"]');
  const textsC = await C.locator('.todo .ttext').allTextContents();
  check('C (Chris): non-assignee does NOT see it', !textsC.some(t => /library books/.test(t)));
  check('C: family tasks still visible', textsC.some(t => /secret gift|buy milk/.test(t)));

  // --- retrospective by assignee: Lulu re-scopes to family → Chris sees it ---
  await B.locator('.todo', { hasText: 'library books' }).locator('.scope-chip').click();
  await B.click('#scopeFamily');
  await C.waitForTimeout(1500);
  await C.click('nav.tabs button[data-view="capture"]');
  await C.click('nav.tabs button[data-view="today"]');
  const textsC2 = await C.locator('.todo .ttext').allTextContents();
  check('C: sees task after assignee re-scoped to family', textsC2.some(t => /library books/.test(t)));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
