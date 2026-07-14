// v31 P1 managed mode: zero-config spaces — anonymous auth, one-tap create,
// keyless ITODO2 invites, membership doc writes, self-hosted coexistence.
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
      const cur = docs.get(path) || {};
      // shallow merge + nested merge for the members map (enough for the test)
      const merged = {...cur, ...data};
      if (cur.members && data.members) merged.members = {...cur.members, ...data.members};
      docs.set(path, merged);
      res.end('{}');
    } else if (url.pathname === '/del'){ docs.delete(JSON.parse(body).path); res.end('{}'); }
    else if (url.pathname === '/dump'){
      const prefix = url.searchParams.get('prefix') + '/';
      const out = {};
      for (const [p, d] of docs) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out[p.slice(prefix.length)] = d;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    } else if (url.pathname === '/doc'){
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(docs.get(url.searchParams.get('path')) || null));
    } else res.end('{}');
  });
});

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_AUTH = `
export function getAuth(app){ if (!app.__auth) app.__auth = {currentUser: null, listeners: []}; return app.__auth; }
export function onAuthStateChanged(a, cb){ a.listeners.push(cb); if (a.currentUser) setTimeout(() => cb(a.currentUser), 0); return () => {}; }
export async function signInAnonymously(a){
  a.currentUser = {uid: 'uid-' + Math.random().toString(36).slice(2, 8)};
  a.listeners.forEach(cb => cb(a.currentUser));
  return {user: a.currentUser};
}`;
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
const MANAGED_CFG = `window.MANAGED = {apiKey: 'AizaManaged', authDomain: 'x.firebaseapp.com', projectId: 'managed-project', appId: '1:1:web:1'};`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mkDevice = async (name) => {
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: MANAGED_CFG }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });
    await page.click('nav.tabs button[data-view="settings"]');
    if (name){ await page.fill('#myNameInput', name); await page.click('#saveMyNameBtn'); }
    return page;
  };

  // ---------- managed UI: no Firebase anywhere ----------
  const A = await mkDevice('alex');
  await A.click('#syncSetup summary');
  check('P1: create is one tap — no config textarea', !(await A.locator('#fbConfigInput').isVisible()));
  check('P1: no Firebase walkthrough shown', !(await A.locator('#selfHostHowto').isVisible()));
  check('P1: summary renamed for managed mode',
    /Create a new space/.test(await A.locator('#syncSetup summary').textContent()));

  // ---------- one-tap create ----------
  await A.fill('#spaceNameInput', 'Home');
  await A.click('#createManagedBtn');
  await A.waitForTimeout(800);
  await A.click('#setupDone');  // v43: dismiss the guided-setup checklist
  await A.waitForTimeout(100);
  const spA = await A.evaluate(() => store.get('spaces'));
  check('P1: managed space created', spA.length === 1 && spA[0].managed === true && spA[0].name === 'Home');
  check('P1: sync active', /active|syncing/i.test(await A.locator('#syncMsg').textContent()));

  // household doc carries the creator's uid in members
  const hh = await fetch('http://localhost:8907/doc?path=' +
    encodeURIComponent('households/' + spA[0].hid)).then(r => r.json());
  const uids = Object.keys(hh.members || {});
  check('P1: creator in members map with display name',
    uids.length === 1 && uids[0].startsWith('uid-') && hh.members[uids[0]] === 'alex');

  // ---------- keyless invite ----------
  const invite = await A.evaluate(() => {
    const sp = store.get('spaces')[0];
    return inviteEncode(sp.cfg, sp.hid, sp.name, sp.type);
  });
  check('P1: invite is ITODO2 with no keys inside', /^ITODO2-/.test(invite) &&
    !JSON.stringify(JSON.parse(Buffer.from(invite.slice(7).replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString())).includes('AizaManaged'));

  // A adds a task
  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'buy milk');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(500);

  // ---------- B joins with just the code ----------
  const B = await mkDevice('sam');
  await B.fill('#inviteInput', invite);
  await B.click('#joinBtn');
  await B.waitForTimeout(1000);
  const spB = await B.evaluate(() => store.get('spaces'));
  check('P1: B joined managed space by code alone', spB.length === 1 && spB[0].managed === true);
  await B.click('nav.tabs button[data-view="today"]');
  check('P1: task synced to B',
    (await B.locator('#todoList .ttext').allTextContents()).some(t => /buy milk/.test(t)));
  const hh2 = await fetch('http://localhost:8907/doc?path=' +
    encodeURIComponent('households/' + spA[0].hid)).then(r => r.json());
  check('P1: B added itself to members before listening',
    Object.keys(hh2.members).length === 2 && Object.values(hh2.members).includes('sam'));

  // B ticks → A sees attribution
  await B.locator('.todo', { hasText: 'buy milk' }).locator('.chk').click();
  await A.waitForTimeout(1000);
  check('P1: tick syncs back with attribution',
    await A.locator('.todo.done', { hasText: 'buy milk' }).count() === 1);

  // ---------- ITODO1 (self-hosted) invites still decode ----------
  const legacy = await A.evaluate(() =>
    inviteDecode('ITODO1-' + btoa(JSON.stringify({k: 'AizaSelf', p: 'self-proj', h: 'hh-old', n: 'Old', t: 'family'}))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')));
  check('P1: legacy self-hosted invites still decode',
    legacy.managed === false && legacy.cfg.projectId === 'self-proj' && legacy.name === 'Old');

  // ---------- events flow into the managed space too ----------
  const evs = await fetch('http://localhost:8907/dump?prefix=' +
    encodeURIComponent('households/' + spA[0].hid + '/events')).then(r => r.json());
  check('P1: audit events flow in managed mode',
    Object.values(evs).some(e => e.kind === 'created') && Object.values(evs).some(e => e.kind === 'ticked'));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
