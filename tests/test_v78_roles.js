// v78: Cooee circle pack Phase 1c — CLIENT side of the role model.
// (The server side — role×scope×CRUD enforcement — is proven by the emulator
// matrix in tests/rules/, CI workflow rules-test.)
// - Circle invites (ITODO2) carry a role; decode CLAMPS to worker/viewer so a
//   crafted code can never mint owner/co-admin (rules refuse it anyway).
// - Joining a circle writes members[uid] = {name, role}; every other space
//   type keeps the legacy name string.
// - Creating a circle makes you its owner; re-asserting membership after an
//   account switch preserves your role instead of demoting you to a string.
const { chromium } = require('playwright');

const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1'};`;
const FLAVOR_CIRCLE = `window.FLAVOR = {id:'cooee', name:'Cooee', cohorts:['ndis-circle','adhd'], flags:{circle:true}};`;
const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_AUTH = `
  export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
  export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
  export async function signInAnonymously(a){ a.currentUser={uid:'u1', getIdToken: async()=>'T'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
const FAKE_FS = `
  export function initializeFirestore(){ return {}; }
  export function persistentLocalCache(){ return {}; }
  export function collection(db,...p){ return {path:p.join('/')}; }
  export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
  export async function setDoc(ref, data, opts){ (window.__writes = window.__writes || []).push({path:ref.path, data, opts}); }
  export async function deleteDoc(){}
  export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
  export function onSnapshot(col,cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (cfgBody, init) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: cfgBody }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('onboarded', 'true'); } catch(e){} });
    if (init) await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  };

  const A = await mk(MANAGED + FLAVOR_CIRCLE, () => {
    localStorage.setItem('myName', JSON.stringify('Emile'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cir', name: 'My Circle', type: 'circle', cfg: null, managed: true, role: 'viewer'},
      {hid: 'hh-fam', name: 'Home', type: 'family', cfg: null, managed: true}]));
  });
  const payload = (code) => JSON.parse(Buffer.from(
    code.split('-').slice(1).join('-').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

  // ---------- 1. invite codes: circle codes carry a role ----------
  check('v78: circle invite defaults to the worker role',
    payload(await A.evaluate(() => inviteEncode(null, 'hh-cir'))).r === 'worker');
  check('v78: viewer invites carry viewer',
    payload(await A.evaluate(() => inviteEncode(null, 'hh-cir', null, null, 'viewer'))).r === 'viewer');
  check('v78: non-circle invites carry no role at all',
    !('r' in payload(await A.evaluate(() => inviteEncode(null, 'hh-fam')))));

  // ---------- 2. decode clamps: a crafted code can never mint privilege ----------
  const craft = (r) => A.evaluate((role) => {
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return inviteDecode('ITODO2-' + b64({h: 'hh-x', n: 'Sneaky', t: 'circle', ...(role ? {r: role} : {})})).role;
  }, r);
  check('v78: crafted owner code clamps to worker', await craft('owner') === 'worker');
  check('v78: crafted co-admin code clamps to worker', await craft('co-admin') === 'worker');
  check('v78: viewer survives the clamp', await craft('viewer') === 'viewer');
  check('v78: roleless circle code defaults to worker', await craft(null) === 'worker');

  // ---------- 3. joining writes role-map membership (circle) vs string (family) ----------
  const join = async (page, obj) => {
    await page.evaluate((o) => {
      const b64 = (x) => btoa(JSON.stringify(x)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      document.getElementById('inviteInput').value = 'ITODO2-' + b64(o);
      document.getElementById('joinBtn').click();
    }, obj);
    await page.waitForTimeout(600);
  };
  await join(A, {h: 'hh-join-cir', n: 'Their Circle', t: 'circle', r: 'viewer'});
  const w1 = await A.evaluate(() => (window.__writes || []).find(w => w.path === 'households/hh-join-cir'));
  check('v78: circle join writes {name, role} into the members map',
    w1 && typeof w1.data.members.u1 === 'object' &&
    w1.data.members.u1.name === 'Emile' && w1.data.members.u1.role === 'viewer');
  check('v78: the joined space remembers my role locally', await A.evaluate(() =>
    JSON.parse(localStorage.getItem('spaces')).find(s => s.hid === 'hh-join-cir').role === 'viewer'));
  await join(A, {h: 'hh-join-fam', n: 'Their Home', t: 'family'});
  const w2 = await A.evaluate(() => (window.__writes || []).find(w => w.path === 'households/hh-join-fam'));
  check('v78: family join still writes the legacy name string',
    w2 && w2.data.members.u1 === 'Emile');

  // ---------- 4. account switch re-assert keeps roles (no silent demotion) ----------
  await A.evaluate(() => { window.__writes = []; return reMemberLocalSpaces(); });
  await A.waitForTimeout(400);
  const reW = await A.evaluate(() => window.__writes || []);
  const reCir = reW.find(w => w.path === 'households/hh-cir');
  const reFam = reW.find(w => w.path === 'households/hh-fam');
  check('v78: re-assert writes the circle role map (viewer stays viewer)',
    reCir && typeof reCir.data.members.u1 === 'object' && reCir.data.members.u1.role === 'viewer');
  check('v78: re-assert keeps family membership a string', reFam && reFam.data.members.u1 === 'Emile');

  // ---------- 5. creating a circle mints the owner ----------
  check('v78: flagged builds offer "Support circle" in Settings', await A.evaluate(() =>
    !!document.querySelector('#spaceTypeSel option[value="circle"]')));
  await A.evaluate(() => {
    window.__writes = [];
    document.getElementById('spaceNameInput').value = 'Blaire’s Circle';
    document.getElementById('spaceTypeSel').value = 'circle';
    document.getElementById('createManagedBtn').click();
  });
  await A.waitForTimeout(600);
  const cw = await A.evaluate(() => (window.__writes || []).find(w => w.data && w.data.type === 'circle'));
  check('v78: circle creation writes members[me] = {name, role: owner}',
    cw && typeof cw.data.members.u1 === 'object' && cw.data.members.u1.role === 'owner');
  check('v78: the created space carries role owner locally', await A.evaluate(() =>
    JSON.parse(localStorage.getItem('spaces')).some(s => s.type === 'circle' && s.name.includes('Circle') && s.role === 'owner' && s.hid.startsWith('hh-') && s.hid !== 'hh-cir')));

  // ---------- 6. default build: no flag, no circle option ----------
  const B = await mk(MANAGED);
  check('v78: default build keeps Settings circle-free', await B.evaluate(() =>
    !document.querySelector('#spaceTypeSel option[value="circle"]')));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
