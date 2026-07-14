// v55: up-front auth gate (Google / email / no account) shown BEFORE onboarding
// in managed mode, plus the new email/password path.
const { chromium } = require('playwright');
const http = require('http');

const docs = new Map();
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS'){ res.end(); return; }
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/set'){ const {path, data} = JSON.parse(body); docs.set(path, {...(docs.get(path) || {}), ...data}); res.end('{}'); }
    else if (url.pathname === '/doc'){ res.setHeader('content-type','application/json'); res.end(JSON.stringify(docs.get(url.searchParams.get('path')) || null)); }
    else if (url.pathname === '/dump'){ const pre = url.searchParams.get('prefix') + '/'; const out = {}; for (const [p, d] of docs) if (p.startsWith(pre) && !p.slice(pre.length).includes('/')) out[p.slice(pre.length)] = d; res.setHeader('content-type','application/json'); res.end(JSON.stringify(out)); }
    else res.end('{}');
  });
});

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
const API='http://localhost:8907';
export function initializeFirestore(app){ return {app}; }
export function persistentLocalCache(){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(ref, data){ await fetch(API+'/set',{method:'POST',body:JSON.stringify({path:ref.path,data})}); }
export async function deleteDoc(){ }
export async function getDoc(ref){ const r=await fetch(API+'/doc?path='+encodeURIComponent(ref.path)); const d=await r.json(); return {exists:()=>d!=null,data:()=>d}; }
export function onSnapshot(col, cb){ cb({docChanges:()=>[]}); return ()=>{}; }`;
const FAKE_AUTH = `
const API='http://localhost:8907';
export function getAuth(app){ if(!app.__auth) app.__auth={currentUser:null,listeners:[]}; return app.__auth; }
export function onAuthStateChanged(a,cb){ a.listeners.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
function mkUser(uid,email,anon){ return {uid,email:email||null,isAnonymous:!!anon,getIdToken:async()=>'tok'}; }
export async function signInAnonymously(a){ a.currentUser=mkUser('anon-'+Math.random().toString(36).slice(2,8),null,true); a.listeners.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }
export class GoogleAuthProvider{ static credentialFromError(e){ return e._cred; } }
export class EmailAuthProvider{ static credential(email,pw){ return {email,pw,__email:true}; } }
async function emGet(email){ const r=await fetch(API+'/doc?path='+encodeURIComponent('em/'+email)); return await r.json(); }
async function emSet(email,uid,pw){ await fetch(API+'/set',{method:'POST',body:JSON.stringify({path:'em/'+email,data:{uid,pw}})}); }
export async function createUserWithEmailAndPassword(a,email,pw){ const ex=await emGet(email); if(ex&&ex.uid){ const e=new Error('in use'); e.code='auth/email-already-in-use'; throw e;} const uid='em-'+Math.random().toString(36).slice(2,8); await emSet(email,uid,pw); a.currentUser=mkUser(uid,email,false); a.listeners.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }
export async function signInWithEmailAndPassword(a,email,pw){ const ex=await emGet(email); if(!ex||!ex.uid){ const e=new Error('nf'); e.code='auth/user-not-found'; throw e;} if(ex.pw!==pw){ const e=new Error('wp'); e.code='auth/wrong-password'; throw e;} a.currentUser=mkUser(ex.uid,email,false); a.listeners.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }
export async function linkWithCredential(user,cred){ const ex=await emGet(cred.email); if(ex&&ex.uid&&ex.uid!==user.uid){ const e=new Error('in use'); e.code='auth/email-already-in-use'; throw e;} await emSet(cred.email,user.uid,cred.pw); user.isAnonymous=false; user.email=cred.email; return {user}; }
export async function linkWithPopup(){ throw new Error('n/a'); }
export async function signInWithPopup(){ throw new Error('n/a'); }
export async function signInWithCredential(){ throw new Error('n/a'); }
export async function sendPasswordResetEmail(a,email){ if(!email.includes('@')){ const e=new Error('bad'); e.code='auth/invalid-email'; throw e;} return; }
export async function signOut(a){ a.currentUser=null; }`;
const MANAGED_CFG = `window.MANAGED={apiKey:'k',authDomain:'x.firebaseapp.com',projectId:'managed-project',appId:'1:1:web:1'};`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mkDevice = async (managed = true) => {
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType:'application/javascript', body: managed ? MANAGED_CFG : 'window.MANAGED=null;' }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_FS }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_AUTH }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(350);
    return page;
  };

  // ---------- managed first run shows the auth gate BEFORE onboarding ----------
  const A = await mkDevice(true);
  check('v55: managed first-run shows the auth gate', await A.locator('#authGate').isVisible());
  check('v55: onboarding is NOT shown yet', !(await A.locator('#onboarding').isVisible()));
  check('v55: gate offers Google, email, and no-account',
    await A.locator('#agGoogleBtn').isVisible() && await A.locator('#agEmailToggle').isVisible() && await A.locator('#agGuestBtn').isVisible());

  // self-hosted build: no gate, straight to onboarding
  const S = await mkDevice(false);
  check('v55: self-hosted first-run skips the gate → onboarding',
    !(await S.locator('#authGate').isVisible()) && await S.locator('#onboarding').isVisible());

  // ---------- "continue without an account" → onboarding ----------
  await A.click('#agGuestBtn');
  await A.waitForTimeout(200);
  check('v55: no-account closes the gate and shows onboarding',
    !(await A.locator('#authGate').isVisible()) && await A.locator('#onboarding').isVisible());
  check('v55: guest stays anonymous (not signed in)', await A.evaluate(() => !isSignedIn()));

  // ---------- email: create account → signed in → onboarding ----------
  const B = await mkDevice(true);
  await B.click('#agEmailToggle');
  await B.waitForTimeout(150);
  check('v55: email form reveals', await B.locator('#agEmailForm').isVisible());
  check('v55: defaults to Create account', /Create account/.test(await B.locator('#agEmailSubmit').textContent()));
  await B.fill('#agEmail', 'parent@example.com');
  await B.fill('#agPw', 'hunter2pw');
  await B.click('#agEmailSubmit');
  await B.waitForTimeout(500);
  check('v55: after create, gate closes and onboarding shows',
    !(await B.locator('#authGate').isVisible()) && await B.locator('#onboarding').isVisible());
  const acct = await B.evaluate(() => ({ signedIn: isSignedIn(), email: accountEmail }));
  check('v55: user is signed in with the email', acct.signedIn && acct.email === 'parent@example.com');

  // ---------- email: wrong password shows a friendly error ----------
  const C = await mkDevice(true);
  await C.click('#agEmailToggle');
  await C.click('#agSwitchMode');   // → sign-in mode
  check('v55: switch to sign-in mode', /Sign in/.test(await C.locator('#agEmailSubmit').textContent()));
  await C.fill('#agEmail', 'parent@example.com');
  await C.fill('#agPw', 'wrongpass');
  await C.click('#agEmailSubmit');
  await C.waitForTimeout(400);
  check('v55: wrong password → friendly error, gate stays open',
    /incorrect/i.test(await C.locator('#agEmailErr').textContent()) && await C.locator('#authGate').isVisible());

  // ---------- email: correct sign-in of the existing account ----------
  await C.fill('#agPw', 'hunter2pw');
  await C.click('#agEmailSubmit');
  await C.waitForTimeout(500);
  check('v55: correct sign-in closes the gate', !(await C.locator('#authGate').isVisible()));
  check('v55: signed in as the existing account', await C.evaluate(() => isSignedIn() && accountEmail === 'parent@example.com'));

  // ---------- Settings exposes email sign-in for guests too ----------
  const D = await mkDevice(true);
  await D.click('#agGuestBtn');          // start as guest
  await D.click('#obSkip');              // skip onboarding
  await D.click('nav.tabs button[data-view="settings"]');
  await D.waitForTimeout(150);
  check('v55: Settings shows both Google and email sign-in for guests',
    await D.locator('#googleSignInBtn').isVisible() && await D.locator('#emailSignInBtn').isVisible());

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
