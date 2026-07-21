// v97 (launch task B1): privacy / terms / support pages exist for both flavors
// and are linked from the app's Settings — with the cooee flavor rewriting the
// links to its site root (the app deploys at /app/ there).
const { chromium } = require('playwright');

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
export function initializeFirestore(app){ return {app}; }
export function persistentLocalCache(){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(){ }
export async function deleteDoc(){ }
export async function getDoc(){ return {exists: () => false, data: () => null}; }
export function onSnapshot(col, cb){ cb({docChanges: () => []}); return () => {}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n + (c ? '' : ' — ' + (extra || ''))); c ? pass++ : fail++; };
  const errors = [];
  const mk = async (flavorJs) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: flavorJs || 'window.MANAGED=null;' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    return p;
  };

  // ---------- 1. the six pages exist, load, and say what they must ----------
  const P = await (await browser.newContext()).newPage();
  const pages = [
    ['privacy.html', [/Privacy policy/, /Australian\s+Privacy\s+Principles/, /Delete account/, /never sell/i]],
    ['terms.html', [/Terms of use/, /not.*medical/i, /Australian\s+Consumer\s+Law/]],
    ['support.html', [/Support/, /Test AI/, /Export backup/]],
    ['flavors/cooee/site/privacy.html', [/Sydney,\s+Australia/, /nothing\s+in\s+a\s+circle\s+is\s+ever\s+hidden\s+from\s+its\s+owner/i, /No GPS/]],
    ['flavors/cooee/site/terms.html', [/Not NDIS advice/i, /support\s+workers\s+and\s+viewers\s+will\s+always\s+be\s+free/i, /NDIS\s+Code\s+of\s+Conduct/]],
    ['flavors/cooee/site/support.html', [/Copy diagnostics/, /Plan\s+Review\s+Pack/]]
  ];
  for (const [path, pats] of pages){
    const res = await P.goto('http://localhost:8906/' + path);
    const body = await P.content();
    check(path + ' serves and reads right', res.status() === 200 && pats.every(re => re.test(body)),
      pats.filter(re => !re.test(body)).join(', '));
  }
  // the compliance-locked word must not appear anywhere on cooee legal pages
  for (const p of ['privacy', 'terms', 'support']){
    await P.goto('http://localhost:8906/flavors/cooee/site/' + p + '.html');
    check('cooee ' + p + ': never says "claimable"', !/claimable/i.test(await P.content()));
  }

  // ---------- 2. ideatodo app: Settings links point at the root pages ----------
  const A = await mk();
  await A.click('nav.tabs button[data-view="settings"]');
  const hrefs = await A.evaluate(() => [...document.querySelectorAll('a.legal-link')].map(a => a.getAttribute('href')));
  check('Settings shows Privacy · Terms · Support', hrefs.length === 3, JSON.stringify(hrefs));
  check('ideatodo links stay relative to the app root',
    JSON.stringify(hrefs) === JSON.stringify(['privacy.html', 'terms.html', 'support.html']), JSON.stringify(hrefs));

  // ---------- 3. cooee flavor: legalBase rewrites to the site root ----------
  const B = await mk(`window.MANAGED=null; window.FLAVOR={id:'cooee', name:'Cooee', legalBase:'../'};`);
  await B.click('nav.tabs button[data-view="settings"]');
  const chrefs = await B.evaluate(() => [...document.querySelectorAll('a.legal-link')].map(a => a.getAttribute('href')));
  check('cooee links climb out of /app/ to the site pages',
    JSON.stringify(chrefs) === JSON.stringify(['../privacy.html', '../terms.html', '../support.html']), JSON.stringify(chrefs));

  // ---------- 4. landing + overview footers link the pages ----------
  await P.goto('http://localhost:8906/index.html');
  const landing = await P.content();
  check('landing footer links privacy/terms/support',
    /href="privacy.html"/.test(landing) && /href="terms.html"/.test(landing) && /href="support.html"/.test(landing));
  await P.goto('http://localhost:8906/flavors/cooee/site/index.html');
  const csite = await P.content();
  check('cooee landing links its own pages',
    /href="privacy.html"/.test(csite) && /href="terms.html"/.test(csite) && /href="support.html"/.test(csite));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
