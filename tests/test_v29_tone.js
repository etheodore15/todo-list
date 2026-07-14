// v29 C1c: tone check on co-parenting spaces — flag hostile wording, offer
// a neutral rewrite, fail open, and stay out of the way on other space types.
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
export function onSnapshot(col, cb){ cb({docChanges: () => []}); return () => {}; }`;

(async () => {
  server.listen(8907);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
  await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));

  let toneCalls = 0;
  await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
    if (route.request().method() === 'GET'){
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({models: [{name: 'models/gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent']}]}) });
      return;
    }
    const body = JSON.parse(route.request().postData());
    const prompt = body.contents[0].parts[0].text;
    if (/communication coach/.test(prompt)){
      toneCalls++;
      const task = (prompt.match(/"""([\s\S]*?)"""/) || [])[1] || '';
      const hostile = /again|useless|typical/.test(task);
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(
          hostile ? {hostile: true, reason: 'Blaming tone toward the other parent.',
                     rewrite: 'Pickup was 25 minutes after the agreed time — please confirm 3pm works.'}
                  : {hostile: false})}]}}]}) });
      return;
    }
    await route.fulfill({ status: 500, body: '{}' });
  });

  const page = await ctx.newPage();
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // seed: one co-parenting space + one family space + a gemini key
  await page.addInitScript(() => {
    if (localStorage.getItem('spaces')) return;
    localStorage.setItem('geminiKey', JSON.stringify('AIza-test'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cop1', name: 'Co-parenting', type: 'coparenting', cfg: {apiKey: 'AizaFake', projectId: 'fake-project'}},
      {hid: 'hh-fam1', name: 'Home', type: 'family', cfg: {apiKey: 'AizaFake', projectId: 'fake-project'}}
    ]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-cop1'));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey: 'AizaFake', projectId: 'fake-project'}));
    localStorage.setItem('householdId', JSON.stringify('hh-cop1'));
  });
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/', { waitUntil: 'load' });
  await page.click('nav.tabs button[data-view="today"]');
  await page.waitForTimeout(400);

  // ---------- hostile text on a co-parenting space → sheet ----------
  await page.locator('#spaceFilter .fchip', { hasText: 'Co-parenting' }).click();
  await page.fill('#quickAdd', 'Tell your father he was late again');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(600);
  check('C1c: tone sheet opens for hostile wording', await page.locator('#toneSheet').isVisible());
  check('C1c: shows both versions',
    /late again/.test(await page.locator('#toneOriginal').textContent()) &&
    /agreed time/.test(await page.locator('#toneRewrite').textContent()));

  await page.click('#toneUse');
  await page.waitForTimeout(300);
  const texts = await page.locator('#todoList .ttext').allTextContents();
  check('C1c: suggested wording used', texts.some(t => /agreed time/.test(t)) && !texts.some(t => /late again/.test(t)));

  // ---------- neutral text → no sheet ----------
  await page.fill('#quickAdd', 'Pack the swimming kit for Saturday');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(600);
  check('C1c: neutral text passes silently', !(await page.locator('#toneSheet').isVisible()));
  check('C1c: neutral task added',
    (await page.locator('#todoList .ttext').allTextContents()).some(t => /swimming kit/.test(t)));

  // ---------- "keep mine" path ----------
  await page.fill('#quickAdd', 'Your mother is useless with sunscreen');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(600);
  await page.click('#toneKeep');
  await page.waitForTimeout(300);
  check('C1c: keep-mine preserves the original',
    (await page.locator('#todoList .ttext').allTextContents()).some(t => /useless with sunscreen/.test(t)));

  // ---------- cancel path keeps the draft ----------
  await page.fill('#quickAdd', 'typical of him to forget the forms');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(600);
  await page.click('#toneCancel');
  await page.waitForTimeout(200);
  check('C1c: cancel keeps the draft in the input',
    (await page.locator('#quickAdd').inputValue()) === 'typical of him to forget the forms');
  check('C1c: cancel adds nothing',
    !(await page.locator('#todoList .ttext').allTextContents()).some(t => /typical of him/.test(t)));
  await page.fill('#quickAdd', '');

  // ---------- family space is never checked ----------
  const callsBefore = toneCalls;
  await page.locator('#spaceFilter .fchip', { hasText: 'Home' }).click();
  await page.fill('#quickAdd', 'he was late again with the bins');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(600);
  check('C1c: family space skips the tone check',
    toneCalls === callsBefore &&
    (await page.locator('#todoList .ttext').allTextContents()).some(t => /bins/.test(t)));

  // ---------- editing a co-parenting task is gated too ----------
  await page.locator('#spaceFilter .fchip', { hasText: 'Co-parenting' }).click();
  const kit = page.locator('.todo', { hasText: 'swimming kit' });
  await kit.locator('.ttext').click();
  await kit.locator('.tact', { hasText: 'Edit' }).click();
  await page.waitForTimeout(150);
  await page.fill('#inputField', 'you forgot the kit again, obviously');
  await page.click('#inputSave');
  await page.waitForTimeout(600);
  check('C1c: edit path also gated', await page.locator('#toneSheet').isVisible());
  await page.click('#toneUse');
  await page.waitForTimeout(300);
  check('C1c: edited text replaced by rewrite',
    (await page.locator('#todoList .ttext').allTextContents()).filter(t => /agreed time/.test(t)).length === 2);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
