const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c?'PASS':'FAIL')+': '+n); c?pass++:fail++; };

  const MODELS = {models: [
    {name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent']},
    {name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent']},
    {name: 'models/gemini-3.0-flash-lite', supportedGenerationMethods: ['generateContent']},
    {name: 'models/gemini-3.0-flash-preview', supportedGenerationMethods: ['generateContent']},
    {name: 'models/gemini-3.0-pro', supportedGenerationMethods: ['generateContent']},
    {name: 'models/embedding-001', supportedGenerationMethods: ['embedContent']},
  ]};
  const GEN_OK = {candidates: [{content: {parts: [{text: JSON.stringify({
    summary: 'Book the dentist.', tasks: [{text: 'Book the dentist', priority: 'medium', tags: ['health']}], priority: 'medium'})}]}}]};

  let genCalls = [];
  await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
    const url = route.request().url();
    if (url.includes('/models?')) return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(MODELS)});
    genCalls.push(url);
    // first generate on a retired model 404s, forcing rediscovery+retry
    if (url.includes('gemini-retired')) return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({error:{message:'model not found'}})});
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(GEN_OK)});
  });

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (localStorage.getItem('geminiKey')) return;
    localStorage.setItem('geminiKey', JSON.stringify('AIza-test'));
    localStorage.setItem('geminiModel', JSON.stringify('gemini-retired'));  // simulate stale cached model
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  // capture: stale model 404s → rediscovery picks gemini-3.0-flash → succeeds
  await page.fill('#liveText', 'I need to book the dentist');
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(700);
  const texts = await page.locator('.todo .ttext').allTextContents();
  check('summary succeeded after 404 retry', texts.some(t => /Book the dentist/.test(t)));
  check('retry used rediscovered newest flash', genCalls.some(u => u.includes('gemini-3.0-flash:generateContent')));
  check('did not pick lite/preview/pro', !genCalls.some(u => /lite|preview|pro/.test(u)));

  // engine chip shows gemini
  await page.click('nav.tabs button[data-view="ideas"]');
  const chips = await page.locator('.card .chip').allTextContents();
  check('engine chip shows gemini', chips.some(c => /gemini/.test(c)));

  // key save runs a live test and reports the model
  await page.click('nav.tabs button[data-view="settings"]');
  await page.fill('#geminiKeyInput', 'AIza-new-key');
  await page.click('#saveGeminiKeyBtn');
  await page.waitForTimeout(500);
  const status = await page.locator('#geminiKeyStatus').textContent();
  console.log('key status:', status);
  check('key test reports working model', /Key works — using gemini-3.0-flash/.test(status));

  // bad key path: make everything 403
  await ctx.unroute('**/generativelanguage.googleapis.com/**');
  await ctx.route('**/generativelanguage.googleapis.com/**', r => r.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error:{message:'API key not valid'}})}));
  await page.fill('#geminiKeyInput', 'AIza-bad');
  await page.click('#saveGeminiKeyBtn');
  await page.waitForTimeout(500);
  const status2 = await page.locator('#geminiKeyStatus').textContent();
  console.log('bad key status:', status2);
  check('bad key shows exact API error', /Key test failed.*403.*API key not valid/.test(status2));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
