const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  // Mock the Gemini endpoint
  let sawRequest = null;
  await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
    sawRequest = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({
        summary: 'Fix the leaking tap urgently.',
        tasks: [{text: 'Call the plumber about the leaking tap', priority: 'high', tags: ['home','calls']}],
        priority: 'high'
      })}]}}]}),
    });
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('geminiKey', JSON.stringify('AIza-test-key')));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  await page.fill('#liveText', 'the tap is leaking I need to call the plumber');
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(600);

  const texts = await page.locator('.todo .ttext').allTextContents();
  const tags = await page.locator('.todo .ttag').allTextContents();
  console.log('tasks:', JSON.stringify(texts), 'tags:', JSON.stringify(tags));
  console.log(sawRequest && sawRequest.generationConfig.responseMimeType === 'application/json' ? 'PASS: structured request sent' : 'FAIL: bad request');
  console.log(texts.some(t => /Call the plumber about the leaking tap/.test(t)) ? 'PASS: Gemini result used' : 'FAIL');
  console.log(tags.includes('home') && tags.includes('calls') ? 'PASS: Gemini tags applied' : 'FAIL: tags missing');

  // Fallback: kill the mock → heuristic still produces a result
  await ctx.unroute('**/generativelanguage.googleapis.com/**');
  await ctx.route('**/generativelanguage.googleapis.com/**', r => r.fulfill({status: 500, body: '{}'}));
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', 'buy milk tomorrow');
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(600);
  const texts2 = await page.locator('.todo .ttext').allTextContents();
  console.log(texts2.some(t => /milk/i.test(t)) ? 'PASS: heuristic fallback on API failure' : 'FAIL: no fallback');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
})();
