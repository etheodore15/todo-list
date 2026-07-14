// v57: hosting restructure — consumer landing at the site root (index.html),
// the app moved to /app.html, and an investor sub-page at /investors.html.
// Verifies the split, the cross-links, and that the app still boots at /app.html.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  const ctx = await browser.newContext();
  // self-hosted so the app boots straight through (no managed auth gate needed here)
  await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));

  // ---------- landing at the root ----------
  await page.goto('http://localhost:8906/index.html', { waitUntil: 'load' });
  const h1 = (await page.locator('h1').first().textContent()) || '';
  check('v57: root landing renders the consumer hero', /shared plan/i.test(h1));
  check('v57: landing links to the app', await page.locator('a[href="app.html"]').count() > 0);
  check('v57: landing links to the investor page', await page.locator('a[href="investors.html"]').count() > 0);
  // consumer focus: the investor pitch is NOT inlined on the landing
  const bodyText = (await page.locator('body').textContent()) || '';
  check('v57: investor metrics are NOT on the consumer landing',
    !/\$0\s*CAC/i.test(bodyText) && !/gross margin/i.test(bodyText));
  check('v57: landing stylesheet is the shared marketing sheet',
    await page.locator('link[href="landing.css"]').count() === 1);

  // ---------- investor sub-page ----------
  await page.goto('http://localhost:8906/investors.html', { waitUntil: 'load' });
  const inv = (await page.locator('body').textContent()) || '';
  check('v57: investor page shows the three-markets wedge', /one engine/i.test(inv));
  check('v57: investor page shows the metrics ($0 CAC)', /\$0/.test(inv) && /CAC/i.test(inv));
  check('v57: investor page is honest about traction (model targets note)',
    /model targets/i.test(inv) && /not reported traction/i.test(inv));
  check('v57: investor page links back to the product', await page.locator('a.backlink').count() > 0);
  check('v57: investor page links to the app', await page.locator('a[href="app.html"]').count() > 0);

  // ---------- the app itself still boots at /app.html ----------
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  check('v57: app boots at /app.html (capture view present)',
    await page.locator('#view-capture').count() === 1);
  check('v57: app version label is v57', /v57/.test(await page.locator('body').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
