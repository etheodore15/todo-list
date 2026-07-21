// v98 (launch task B2): in-app account deletion — Apple 5.1.1(v) / Play
// requirement, and owed to users regardless. Self-removal from members where
// the rules allow it, per-account docs deleted, then the auth user; shared
// records deliberately survive for remaining members; device data stays
// unless the user opts into the follow-up wipe.
const { chromium } = require('playwright');

const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1', aiProxy:'https://proxy.example/ai'};`;
const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const mkAuth = (failDelete) => `
  export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
  export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
  export async function signInAnonymously(a){
    a.currentUser={uid:'u1', isAnonymous:true, getIdToken: async()=>'TOKEN-123',
      delete: async()=>{ ${failDelete
        ? "const e=new Error('needs recent login'); e.code='auth/requires-recent-login'; throw e;"
        : "window.__authDeleted=true; a.currentUser=null;"} }};
    a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
const FAKE_FS = `
  export function initializeFirestore(){ return {}; }
  export function persistentLocalCache(){ return {}; }
  export function collection(db,...p){ return {path:p.join('/')}; }
  export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
  export async function setDoc(){}
  export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
  export function onSnapshot(col,cb){ cb({docChanges:()=>[]}); return ()=>{}; }
  export function deleteField(){ return '__DELETE_FIELD__'; }
  export async function updateDoc(ref, patch){
    (window.__updates = window.__updates || []).push({path: ref.path, patch});
    if (/hh-circle/.test(ref.path)){ const e = new Error('permission denied'); e.code = 'permission-denied'; throw e; }
  }
  export async function deleteDoc(ref){ (window.__deletes = window.__deletes || []).push(ref.path); }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n + (c ? '' : ' — ' + (extra || ''))); c ? pass++ : fail++; };
  const errors = [];

  const SPACES_INIT = () => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-fam', name: 'Home', type: 'family', cfg: null, managed: true},
      {hid: 'hh-circle', name: "Liam's circle", type: 'circle', role: 'worker', cfg: null, managed: true}]));
    localStorage.setItem('todos', JSON.stringify([
      {id: 't1', text: 'Fix the gate', priority: 'medium', tags: [], done: false, space: 'hh-fam'},
      {id: 't2', text: 'Private thing', priority: 'low', tags: [], done: false}]));
  };

  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: opts.managed === false ? 'window.MANAGED=null;' : MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: mkAuth(!!opts.recentLogin) }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    if (opts.init) await p.addInitScript(opts.init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(600);
    return p;
  };

  // ---------- 1. the full happy path ----------
  const A = await mk({ init: SPACES_INIT });
  await A.click('nav.tabs button[data-view="settings"]');
  check('the delete zone shows for an account with managed spaces',
    await A.locator('#deleteAcctWrap').isVisible());
  check('the copy is honest about what survives',
    /keep their append-only record/.test(await A.locator('#deleteAcctWrap').textContent()));
  // answer by call order: confirm #1 (delete) = yes, prompt = DELETE, confirm #2 (wipe device) = no
  await A.evaluate(() => {
    window.__dialogs = []; let confirms = 0;
    window.confirm = (m) => { window.__dialogs.push(m); return confirms++ === 0; };
    window.prompt = (m) => { window.__dialogs.push(m); return 'delete'; };   // case-insensitive accept
  });
  await A.click('#deleteAcctBtn');
  await A.waitForTimeout(900);
  check('self-removal attempted on BOTH spaces via members.<uid> deleteField', await A.evaluate(() =>
    (window.__updates || []).length === 2 &&
    window.__updates.every(u => u.patch['members.u1'] === '__DELETE_FIELD__') &&
    window.__updates.some(u => /hh-fam/.test(u.path)) && window.__updates.some(u => /hh-circle/.test(u.path))));
  check('the circle denial (worker can’t edit members) doesn’t stop the flow', await A.evaluate(() =>
    window.__authDeleted === true));
  check('per-account docs deleted (users + cohorts)', await A.evaluate(() =>
    (window.__deletes || []).includes('users/u1') && (window.__deletes || []).includes('cohorts/u1')));
  check('managed spaces are gone locally', await A.evaluate(() =>
    JSON.parse(localStorage.getItem('spaces')).length === 0));
  check('their tasks stay on the device, personal now', await A.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('todos'));
    return t.length === 2 && t.find(x => x.id === 't1').space === null;
  }));
  check('declining the device wipe keeps local data', await A.evaluate(() =>
    !!localStorage.getItem('todos') && /THIS device/.test(window.__dialogs[window.__dialogs.length - 1])));
  check('the success toast reassures about device data',
    /Account deleted.*still on this device/.test(await A.locator('#toast').textContent()),
    await A.locator('#toast').textContent());

  // ---------- 2. the typed confirmation actually gates ----------
  const B = await mk({ init: SPACES_INIT });
  await B.click('nav.tabs button[data-view="settings"]');
  await B.evaluate(() => { window.confirm = () => true; window.prompt = () => 'yes do it'; });
  await B.click('#deleteAcctBtn');
  await B.waitForTimeout(600);
  check('wrong typed confirmation deletes nothing', await B.evaluate(() =>
    !window.__authDeleted && !(window.__updates || []).length && !(window.__deletes || []).length &&
    JSON.parse(localStorage.getItem('spaces')).length === 2));
  check('and says so', /cancelled/.test(await B.locator('#toast').textContent()));

  // ---------- 3. requires-recent-login: honest error, nothing lost locally ----------
  const C = await mk({ init: SPACES_INIT, recentLogin: true });
  await C.click('nav.tabs button[data-view="settings"]');
  await C.evaluate(() => { let confirms = 0; window.confirm = () => confirms++ === 0; window.prompt = () => 'DELETE'; });
  await C.click('#deleteAcctBtn');
  await C.waitForTimeout(900);
  check('a stale session gets the fresh-sign-in explanation',
    /fresh sign-in/.test(await C.locator('#toast').textContent()),
    await C.locator('#toast').textContent());
  check('local spaces are kept when the server deletion failed', await C.evaluate(() =>
    JSON.parse(localStorage.getItem('spaces')).length === 2));
  check('the button recovers for a retry', await C.evaluate(() =>
    !document.getElementById('deleteAcctBtn').disabled &&
    document.getElementById('deleteAcctBtn').textContent === 'Delete account…'));

  // ---------- 4. the follow-up device wipe, accepted ----------
  const D = await mk({ init: SPACES_INIT });
  let wiped = false;
  await D.exposeFunction('reportWipe', () => { wiped = true; });   // survives the reload
  await D.click('nav.tabs button[data-view="settings"]');
  await D.evaluate(() => {
    window.confirm = () => true; window.prompt = () => 'DELETE';
    const orig = localStorage.clear.bind(localStorage);
    localStorage.clear = () => { window.reportWipe(); orig(); };
  });
  await D.click('#deleteAcctBtn');
  await D.waitForTimeout(2600);   // deletion + wipe + reload
  check('accepting the wipe clears the device and restarts', wiped);

  // ---------- 5. self-hosted build → no account section at all ----------
  const E = await mk({ managed: false });
  await E.click('nav.tabs button[data-view="settings"]');
  check('a self-hosted build shows no account/delete section',
    !(await E.locator('#deleteAcctWrap').isVisible()));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
