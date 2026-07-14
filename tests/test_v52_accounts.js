// v52: optional Google sign-in with anonymous-account LINKING + a per-user
// "my spaces" doc so a signed-in account restores its spaces on a new device.
const { chromium } = require('playwright');
const http = require('http');

// shared firestore + auth state (docs keyed by path); authmap/{email} → {uid}
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
export function onSnapshot(col, cb){ let first=true; const poll=async()=>{ try{ const r=await fetch(API+'/dump?prefix='+encodeURIComponent(col.path)); const cur=await r.json(); const ch=Object.entries(cur).map(([id,data])=>({type:'added',doc:{id,data:()=>data}})); if(ch.length||first)cb({docChanges:()=>ch}); first=false;}catch(e){} }; poll(); const t=setInterval(poll,200); return ()=>clearInterval(t); }`;
const FAKE_AUTH = `
const API='http://localhost:8907';
export function getAuth(app){ if(!app.__auth) app.__auth={currentUser:null,listeners:[]}; return app.__auth; }
export function onAuthStateChanged(a,cb){ a.listeners.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
function mkUser(uid,email,anon){ return {uid,email:email||null,isAnonymous:!!anon,getIdToken:async()=>'tok-'+uid}; }
export async function signInAnonymously(a){ const uid='anon-'+Math.random().toString(36).slice(2,8); a.currentUser=mkUser(uid,null,true); a.listeners.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }
export class GoogleAuthProvider{ static credentialFromError(e){ return e._cred; } }
async function bindGet(email){ const r=await fetch(API+'/doc?path='+encodeURIComponent('authmap/'+email)); return await r.json(); }
async function bindSet(email,uid){ await fetch(API+'/set',{method:'POST',body:JSON.stringify({path:'authmap/'+email,data:{uid}})}); }
const EMAIL='test@gmail.com';
export async function linkWithPopup(user,provider){ const ex=await bindGet(EMAIL); if(ex&&ex.uid&&ex.uid!==user.uid){ const e=new Error('in use'); e.code='auth/credential-already-in-use'; e._cred={email:EMAIL}; throw e; } await bindSet(EMAIL,user.uid); user.isAnonymous=false; user.email=EMAIL; return {user}; }
export async function signInWithPopup(a,provider){ let b=await bindGet(EMAIL); let uid=(b&&b.uid); if(!uid){ uid='google-'+Math.random().toString(36).slice(2,8); await bindSet(EMAIL,uid); } a.currentUser=mkUser(uid,EMAIL,false); a.listeners.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }
export async function signInWithCredential(a,cred){ const b=await bindGet(cred.email); const uid=(b&&b.uid)||('google-'+Math.random().toString(36).slice(2,8)); a.currentUser=mkUser(uid,cred.email,false); a.listeners.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }
export async function signOut(a){ a.currentUser=null; }`;
const MANAGED_CFG = `window.MANAGED={apiKey:'k',authDomain:'x.firebaseapp.com',projectId:'managed-project',appId:'1:1:web:1'};`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mkDevice = async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType:'application/javascript', body: MANAGED_CFG }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_FS }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType:'application/javascript', body: FAKE_AUTH }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  // ---------- Account UI only appears in managed mode ----------
  const D1 = await mkDevice();
  await D1.click('nav.tabs button[data-view="settings"]');
  await D1.waitForTimeout(150);
  check('v52: Account section shows in managed mode', await D1.locator('#accountBlock').isVisible());
  check('v52: starts as device-only (guest)', /this device only/i.test(await D1.locator('#accountStatus').textContent()));

  // create a managed space (anonymous)
  await D1.evaluate(() => { document.getElementById('myNameInput').value = 'Alex'; document.getElementById('saveMyNameBtn').click(); });
  await D1.click('#syncSetup details summary');
  await D1.fill('#spaceNameInput', 'Mum care');
  await D1.selectOption('#spaceTypeSel', 'care');
  await D1.click('#createManagedBtn');
  await D1.waitForTimeout(800);
  await D1.click('#setupDone');
  const anonUid = await D1.evaluate(() => managedUid);
  check('v52: space created under an anonymous uid', /^anon-/.test(anonUid || ''));

  // ---------- sign in with Google → LINK (uid preserved) ----------
  await D1.click('#googleSignInBtn');
  await D1.waitForTimeout(800);
  const afterLink = await D1.evaluate(() => ({ uid: managedUid, email: accountEmail, anon: accountAnon }));
  check('v52: linking preserves the same uid (spaces stay valid)', afterLink.uid === anonUid);
  check('v52: now signed in with the Google email', afterLink.email === 'test@gmail.com' && afterLink.anon === false);
  check('v52: Account UI flips to signed-in', /Signed in as test@gmail.com/.test(await D1.locator('#accountStatus').textContent()));
  check('v52: Sign out button now shown', await D1.locator('#signOutBtn').isVisible());
  // the user's "my spaces" doc was written
  const userDoc = await new Promise(res => http.get('http://localhost:8907/doc?path=' + encodeURIComponent('users/' + anonUid), r => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>res(JSON.parse(b))); }));
  check('v52: user-spaces doc mirrors the created space',
    userDoc && Array.isArray(userDoc.spaces) && userDoc.spaces.some(s => s.name === 'Mum care'));

  // ---------- device 2: fresh, signs in with the SAME account → restores spaces ----------
  const D2 = await mkDevice();
  check('v52: device 2 starts with no spaces', await D2.evaluate(() => spacesList().length === 0));
  await D2.click('nav.tabs button[data-view="settings"]');
  await D2.waitForTimeout(150);
  await D2.click('#googleSignInBtn');   // anon → link fails (already in use) → sign into existing acct → restore
  await D2.waitForTimeout(1200);
  const d2 = await D2.evaluate(() => ({ uid: managedUid, spaces: spacesList().map(s => s.name), anon: accountAnon }));
  check('v52: device 2 resolves to the same account uid', d2.uid === anonUid);
  check('v52: device 2 RESTORED the space from the account (cross-device)', d2.spaces.includes('Mum care'));
  check('v52: device 2 is signed in (not anonymous)', d2.anon === false);

  // ---------- sign out returns to guest ----------
  D1.on('dialog', dlg => dlg.accept());
  await D1.click('#signOutBtn');
  await D1.waitForTimeout(300);
  check('v52: sign out returns to guest state',
    await D1.evaluate(() => !isSignedIn()) && /this device only/i.test(await D1.locator('#accountStatus').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
