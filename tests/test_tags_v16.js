const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  let lastPrompt = '';
  await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
    if (route.request().method() === 'GET'){    // v18+ model discovery
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({models: [{name: 'models/gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent']}]}) });
      return;
    }
    const body = JSON.parse(route.request().postData());
    lastPrompt = body.contents[0].parts[0].text;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({
        summary: 'Sort the insurance renewal.',
        tasks: [{text: 'Renew the car insurance', priority: 'medium', tags: ['finance','car']}],
        priority: 'medium'
      })}]}}]}) });
  });
  const page = await ctx.newPage();
  // seed: existing todos with an established tag vocabulary + a gemini key
  await page.addInitScript(() => {
    if (localStorage.getItem('todos')) return; // don't clobber on reload
    localStorage.setItem('geminiKey', JSON.stringify('AIza-test'));
    localStorage.setItem('todos', JSON.stringify([
      {id:'a', text:'Pay rates', priority:'medium', tags:['finance'], done:false, date: new Date().toISOString().slice(0,10), ideaId:null},
      {id:'b', text:'Call the school', priority:'medium', tags:['calls','family'], done:false, date: new Date().toISOString().slice(0,10), ideaId:null},
    ]));
  });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c?'PASS':'FAIL')+': '+n); c?pass++:fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });

  // capture → prompt should include the existing tag vocabulary
  await page.fill('#liveText', 'I need to renew the car insurance');
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  check('prompt primes existing tags', /existing tags.*finance/s.test(lastPrompt));
  check('prompt demands reuse', /STRONGLY prefer reusing/.test(lastPrompt));

  // tag editing via tap
  await page.click('nav.tabs button[data-view="today"]');
  await page.locator('.todo', { hasText: 'Renew the car insurance' }).locator('.ttags').click();
  await page.waitForTimeout(150);
  await page.fill('#inputField', 'work, urgent');
  await page.click('#inputSave');
  await page.waitForTimeout(300);
  const tags = await page.locator('.todo', { hasText: 'Renew the car insurance' }).locator('.ttag').allTextContents();
  check('tag edit applied', tags.includes('work') && tags.includes('urgent'));

  // editing tags must not toggle the transcript
  check('no transcript opened by tag edit', await page.locator('.todo .transcript').count() === 0);

  // persists across reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('nav.tabs button[data-view="today"]');
  const tags2 = await page.locator('.todo', { hasText: 'Renew the car insurance' }).locator('.ttag').allTextContents();
  check('edited tags persist', tags2.includes('work') && tags2.includes('urgent'));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
