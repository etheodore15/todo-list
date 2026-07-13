// v34 C2a: care recipient profile. Shared on the care space's household doc,
// shown atop Today for care spaces, folded into the doctor briefing.
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
    } else if (url.pathname === '/doc'){
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(docs.get(url.searchParams.get('path')) || null));
    } else if (url.pathname === '/dump'){
      const prefix = url.searchParams.get('prefix') + '/';
      const out = {};
      for (const [p, d] of docs) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out[p.slice(prefix.length)] = d;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
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
export async function deleteDoc(ref){ }
export async function getDoc(ref){
  const r = await fetch(API + '/doc?path=' + encodeURIComponent(ref.path));
  const d = await r.json();
  return {exists: () => d != null, data: () => d};
}
export function onSnapshot(col, cb){
  const known = {}; let first = true;
  const poll = async () => {
    const r = await fetch(API + '/dump?prefix=' + encodeURIComponent(col.path));
    const cur = await r.json(); const changes = [];
    for (const [id, data] of Object.entries(cur)){
      const s = JSON.stringify(data);
      if (!(id in known)) changes.push({type:'added', doc:{id, data:()=>data}});
      else if (known[id] !== s) changes.push({type:'modified', doc:{id, data:()=>data}});
      known[id] = s;
    }
    if (changes.length || first) cb({docChanges: () => changes}); first = false;
  };
  poll(); const t = setInterval(poll, 250); return () => clearInterval(t);
}`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mkDevice = async (name) => {
    const ctx = await browser.newContext();
    await ctx.route('**/generativelanguage.googleapis.com/**', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({models: [{name:'models/gemini-2.5-flash', supportedGenerationMethods:['generateContent']}]}) }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript((n) => {
      if (localStorage.getItem('spaces')) return;
      localStorage.setItem('myName', JSON.stringify(n));
      localStorage.setItem('geminiKey', JSON.stringify('AIza-test'));
      localStorage.setItem('spaces', JSON.stringify([
        {hid: 'hh-care', name: "Mum's care", type: 'care', cfg: {apiKey: 'k', projectId: 'p'}}]));
      localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
      localStorage.setItem('fbConfig', JSON.stringify({apiKey: 'k', projectId: 'p'}));
      localStorage.setItem('householdId', JSON.stringify('hh-care'));
    }, name);
    await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    return page;
  };

  // ---------- A fills the profile ----------
  const A = await mkDevice('alex');
  await A.click('nav.tabs button[data-view="settings"]');
  await A.locator('#spacesList button', { hasText: 'Care profile' }).click();
  check('C2a: profile sheet opens', await A.locator('#profileSheet').isVisible());
  await A.evaluate(() => {
    const set = (k, v) => { const el = document.querySelector(`#profileFields .profile-input[data-k="${k}"]`); el.value = v; };
    set('name', 'Margaret'); set('age', '82'); set('conditions', 'dementia, type 2 diabetes');
    set('allergies', 'penicillin'); set('contacts', 'Dr Lee 555-0100');
  });
  await A.click('#profileSave');
  await A.waitForTimeout(400);
  const doc = await fetch('http://localhost:8907/doc?path=' + encodeURIComponent('households/hh-care')).then(r => r.json());
  check('C2a: profile written to household doc',
    doc && doc.profile && doc.profile.name === 'Margaret' && /dementia/.test(doc.profile.conditions));

  // ---------- profile card atop Today ----------
  await A.click('nav.tabs button[data-view="today"]');
  await A.waitForTimeout(300);
  const card = await A.locator('#profileCards').textContent();
  check('C2a: profile card shows name + age', /Margaret/.test(card) && /82/.test(card));
  check('C2a: card shows conditions + allergies', /dementia/.test(card) && /penicillin/.test(card));
  check('C2a: card has an Edit button', await A.locator('.profile-edit').count() >= 1);

  // ---------- B (care team member) pulls the shared profile on connect ----------
  const B = await mkDevice('sam');
  await B.waitForTimeout(900);   // getDoc at space connect
  await B.click('nav.tabs button[data-view="today"]');
  await B.waitForTimeout(300);
  check('C2a: second carer sees the shared profile',
    /Margaret/.test(await B.locator('#profileCards').textContent()));

  // ---------- profile feeds the doctor briefing prompt ----------
  const briefPrompt = await A.evaluate(async () => {
    // stub fetch to capture the briefing prompt
    let captured = '';
    const orig = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('generateContent') && o && /doctor visit/.test(o.body || '')){
        captured = JSON.parse(o.body).contents[0].parts[0].text;
        return {ok: true, json: async () => ({candidates:[{content:{parts:[{text: JSON.stringify({overview:'x',observations:[],routines:[],concerns:[],questions:[]})}]}}]})};
      }
      return orig(u, o);
    };
    const sp = store.get('spaces')[0];
    await geminiBriefing(sp, 'AIza-test');
    window.fetch = orig;
    return captured;
  });
  check('C2a: briefing prompt includes the care recipient profile',
    /Care recipient:/.test(briefPrompt) && /Margaret/.test(briefPrompt) && /penicillin/.test(briefPrompt));

  // ---------- family spaces never get a profile card / button ----------
  const noProfileForFamily = await A.evaluate(() => {
    const p = getProfile('hh-none');
    return p === null;
  });
  check('C2a: unconfigured space has no profile', noProfileForFamily);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
