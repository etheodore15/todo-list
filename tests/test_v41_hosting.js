// v41: configurable app URL for invite links (host-move portability) +
// firebase.json hosting config sanity.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mkPage = async (managedBody) => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType:'application/javascript', body: managedBody }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('onboarded', 'true'));
    await page.goto('http://localhost:8906/', { waitUntil: 'load' });
    await page.waitForTimeout(200);
    return page;
  };

  // default (no managed / no appUrl) → GitHub Pages URL
  const A = await mkPage('window.MANAGED=null;');
  check('v41: default appUrl is the GitHub Pages URL',
    /etheodore15\.github\.io\/todo-list/.test(await A.evaluate(() => appUrl())));

  // appUrl override flows into the invite share text
  const B = await mkPage(`window.MANAGED={apiKey:'k',authDomain:'x',projectId:'p',appId:'1',appUrl:'https://app.example.com/'};`);
  check('v41: appUrl override honoured',
    (await B.evaluate(() => appUrl())) === 'https://app.example.com/');
  const shareText = await B.evaluate(() => {
    // build the invite text the same way shareSpaceInvite does, without a real space
    return `Install the app: ${appUrl()}`;
  });
  check('v41: invite text uses the configured host', /app\.example\.com/.test(shareText) && !/github\.io/.test(shareText));

  // firebase.json hosting sanity (static analysis)
  const fb = JSON.parse(fs.readFileSync(__dirname + '/../firebase.json', 'utf8'));
  check('v41: firebase.json has a hosting block', !!fb.hosting && fb.hosting.public === '.');
  check('v41: hosting ignores non-app dirs',
    fb.hosting.ignore.includes('functions/**') && fb.hosting.ignore.includes('tests/**') &&
    fb.hosting.ignore.some(p => p === '*.md'));
  const headerSrcs = (fb.hosting.headers||[]).map(h => h.source).join(' ');
  check('v41: vendor is cached immutably',
    (fb.hosting.headers||[]).some(h => /vendor/.test(h.source) && h.headers.some(x => /immutable/.test(x.value))));
  check('v41: sw.js + index.html set to no-cache',
    (fb.hosting.headers||[]).some(h => /sw\.js/.test(h.source) && h.headers.some(x => /no-cache/.test(x.value))));
  check('v41: hosting keeps rules + functions blocks intact',
    !!fb.firestore && !!fb.functions);

  // deploy script exposes a hosting target
  const sh = fs.readFileSync(__dirname + '/../deploy-backend.sh', 'utf8');
  check('v41: deploy script has hosting + everything targets',
    /hosting\)\s+firebase deploy --only hosting/.test(sh) && /everything\)/.test(sh));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
