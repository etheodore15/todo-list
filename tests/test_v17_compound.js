const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c?'PASS':'FAIL')+': '+n); c?pass++:fail++; };
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  // The user's exact transcript (no Gemini key → built-in heuristic path)
  await page.fill('#liveText', "I had a very restless sleep last night and it wasn't enjoyable of working up quite tired. I need to make sure that I have a good sleep tonight. Also need to make sure that I put on my pajamas and brush my teeth and rinse my mouth out with salt because I have an ulcer that's giving me grief on my cheek.");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const texts = await page.locator('.todo .ttext').allTextContents();
  console.log('tasks:', JSON.stringify(texts, null, 1));
  check('4 tasks extracted', texts.length === 4);
  check('sleep task', texts.some(t => /good sleep tonight/i.test(t)));
  check('pajamas task split out', texts.some(t => /^Put on my pajamas/i.test(t)));
  check('brush teeth split out', texts.some(t => /^Brush my teeth/i.test(t)));
  check('salt rinse split out', texts.some(t => /^Rinse my mouth/i.test(t)));
  check('no "Make sure that I" prefix', texts.every(t => !/make sure/i.test(t)));
  check('observation not a task', texts.every(t => !/restless/i.test(t)));
  const tags = await page.locator('.todo .ttag').allTextContents();
  check('health tags applied', tags.filter(t => t === 'health').length >= 2);

  // engine chip on the idea card
  await page.click('nav.tabs button[data-view="ideas"]');
  const chips = await page.locator('.card .chip').allTextContents();
  check('engine chip shows built-in', chips.some(c => /built-in/.test(c)));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
