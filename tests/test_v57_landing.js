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

  // ---------- animated demos (hero transcription + 3 flow vignettes) ----------
  check('anim: hero + three vignettes have animation stages',
    await page.locator('[data-cycle]').count() === 4);
  await page.waitForTimeout(1600);   // mid-cycle: typing underway, tasks not in yet
  const midLen = ((await page.locator('#heroType').textContent()) || '').length;
  const midTasks = await page.locator('.demo .task.on').count();
  await page.waitForTimeout(4200);   // late-cycle: typing done, tasks cascaded in
  const endLen = ((await page.locator('#heroType').textContent()) || '').length;
  const endTasks = await page.locator('.demo .task.on').count();
  check('anim: hero transcript types out over time', midLen > 5 && endLen > midLen && endLen > 100);
  check('anim: tasks appear only after the transcription', midTasks === 0 && endTasks === 3);
  await page.waitForTimeout(1600);   // ~7.4s in: invite code (4.7s) + missed banner (6.8s) shown
  check('anim: space-creation vignette reaches its invite code',
    await page.locator('.mini.ok.on .mcode').count() === 1);
  check('anim: reminder vignette flags the missed dose',
    await page.locator('.vmiss.on').count() === 1);

  // reduced motion → static final state, no animation runner
  const rctx = await browser.newContext({ reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  await rp.goto('http://localhost:8906/index.html', { waitUntil: 'load' });
  await rp.waitForTimeout(400);
  check('anim: reduced-motion shows the full static demo',
    ((await rp.locator('#heroType').textContent()) || '').length > 100 &&
    (await rp.locator('.run').count()) === 0);
  await rctx.close();

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
  check('v57: app version label present', /Idea → Todo v\d+/.test(await page.locator('body').textContent()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
