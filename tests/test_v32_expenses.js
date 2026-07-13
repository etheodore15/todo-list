// v32 C1d: expenses + receipts + ledger. Amount on a task, receipt thumb
// compressed + pushed to the space's append-only receipts subcollection,
// per-person ledger with owed split, CSV export.
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
    } else if (url.pathname === '/del'){ docs.delete(JSON.parse(body).path); res.end('{}'); }
    else if (url.pathname === '/dump'){
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
    const hid = 'hh-cop';
    await page.addInitScript((n) => {
      if (localStorage.getItem('spaces')) return;
      localStorage.setItem('myName', JSON.stringify(n));
      localStorage.setItem('spaces', JSON.stringify([
        {hid: 'hh-cop', name: 'Co-parenting', type: 'coparenting', cfg: {apiKey: 'k', projectId: 'p'}}]));
      localStorage.setItem('defaultSpace', JSON.stringify('hh-cop'));
      localStorage.setItem('fbConfig', JSON.stringify({apiKey: 'k', projectId: 'p'}));
      localStorage.setItem('householdId', JSON.stringify('hh-cop'));
    }, name);
    await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    return page;
  };

  // ---------- A logs an expense with an amount ----------
  const A = await mkDevice('alex');
  await A.click('nav.tabs button[data-view="today"]');
  await A.fill('#quickAdd', 'school shoes for the kids');
  await A.click('#quickAddBtn');
  await A.waitForTimeout(400);
  const shoes = A.locator('.todo', { hasText: 'school shoes' });
  await shoes.locator('.ttext').click();
  check('C1d: Expense action in detail panel', await shoes.locator('.tact', { hasText: 'Expense' }).count() === 1);
  await shoes.locator('.tact', { hasText: 'Expense' }).click();
  check('C1d: expense sheet opens', await A.locator('#expSheet').isVisible());
  await A.fill('#expAmount', '60');
  await A.click('#expSave');
  await A.waitForTimeout(500);
  check('C1d: amount chip shows on the task',
    /\$60\.00/.test(await A.locator('.todo', { hasText: 'school shoes' }).locator('.amount-chip').textContent()));
  const rc = await fetch('http://localhost:8907/dump?prefix=' + encodeURIComponent('households/hh-cop/receipts')).then(r => r.json());
  check('C1d: receipt pushed to space with who + amount',
    Object.values(rc).some(r => r.amount === 60 && r.who === 'alex' && r.note === 'school shoes for the kids'));
  const evs = await fetch('http://localhost:8907/dump?prefix=' + encodeURIComponent('households/hh-cop/events')).then(r => r.json());
  check('C1d: expense logged in audit history',
    Object.values(evs).some(e => e.kind === 'expense' && /\$60/.test(e.detail)));

  // ---------- image compression ----------
  const compressed = await A.evaluate(async () => {
    // build a 2000x1500 canvas, export as a File, run it through compressImage
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 400; i++){ ctx.fillStyle = `hsl(${i},70%,50%)`; ctx.fillRect(Math.random()*2000, Math.random()*1500, 60, 60); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'r.png', {type: 'image/png'});
    const thumb = await compressImage(file);
    return {ok: !!thumb, kb: thumb ? Math.round(thumb.length/1024) : 0, isJpeg: thumb && thumb.startsWith('data:image/jpeg')};
  });
  check('C1d: compressImage produces a small JPEG data URI',
    compressed.ok && compressed.isJpeg && compressed.kb <= 250);

  // ---------- B joins, adds their own expense → ledger balances ----------
  const B = await mkDevice('sam');
  await B.waitForTimeout(800);   // sync down A's expense + task
  await B.click('nav.tabs button[data-view="today"]');
  await B.waitForTimeout(400);
  await B.fill('#quickAdd', 'winter coats');
  await B.click('#quickAddBtn');
  await B.waitForTimeout(300);
  const coat = B.locator('.todo', { hasText: 'winter coats' });
  await coat.locator('.ttext').click();
  await coat.locator('.tact', { hasText: 'Expense' }).click();
  await B.fill('#expAmount', '140');
  await B.click('#expSave');
  await B.waitForTimeout(500);

  // ---------- A opens the ledger ----------
  await A.click('nav.tabs button[data-view="settings"]');
  await A.locator('#spacesList button', { hasText: 'Ledger' }).click();
  await A.waitForTimeout(900);
  const totals = await A.locator('#ledgerTotals').textContent();
  check('C1d: ledger totals both expenses', /Total: \$200\.00/.test(totals));
  check('C1d: ledger shows per-person paid', /alex paid \$60\.00/.test(totals) && /sam paid \$140\.00/.test(totals));
  // equal split of $200 = $100 each; alex paid 60, owes 40; but "owes X/2" convention:
  // net alex = -40, sam = +40, half the gap = 40 → alex owes sam $40
  check('C1d: owed split computed', /alex owes sam \$40\.00/.test(totals));
  check('C1d: ledger lists both line items',
    (await A.locator('.ledger-line').count()) === 2);

  // ---------- CSV ----------
  const csv = await A.evaluate(() => {
    const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = [['timestamp','date','who','task','amount','has_receipt'].join(',')];
    [...ledgerRcs].sort((a,b)=>a.ts-b.ts).forEach(rc =>
      rows.push([rc.ts, new Date(rc.ts).toLocaleDateString(), esc(rc.who||''), esc(rc.note||''),
        (rc.amount||0).toFixed(2), rc.thumb?'yes':'no'].join(',')));
    return rows.join('\n');
  });
  check('C1d: CSV has header + both rows', csv.split('\n').length === 3 && /school shoes/.test(csv) && /140.00/.test(csv));

  // ---------- amount persists across reload ----------
  await A.reload({ waitUntil: 'load' });
  await A.waitForTimeout(400);
  await A.click('nav.tabs button[data-view="today"]');
  check('C1d: amount persists on the task after reload',
    (await A.locator('.amount-chip').allTextContents()).some(t => /\$60\.00/.test(t)));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
