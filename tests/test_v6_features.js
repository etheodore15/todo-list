const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = 0, fail = 0;
  const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name); cond ? pass++ : fail++; };

  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });

  await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });

  // 1. Observations do NOT become tasks; actions do.
  await page.fill('#liveText', "the weather is really nice this morning, and I need to pay the electricity bill today it's urgent, and the dog seems much happier lately");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  let texts = await page.locator('.todo .ttext').allTextContents();
  check('only the action became a task', texts.length === 1 && /electricity bill/i.test(texts[0]));

  // 2. Pure observation → zero tasks, idea still saved.
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', "it's amazing how quiet the office is on Fridays");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  await page.click('nav.tabs button[data-view="today"]');
  check('pure observation adds no task', await page.locator('.todo').count() === 1);
  await page.click('nav.tabs button[data-view="ideas"]');
  check('observation still saved as idea', await page.locator('.card').count() === 2);

  // 3. Tags: auto-applied and shown as chips.
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', "I need to buy groceries for dinner and also call mum about her birthday present");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const chipTexts = await page.locator('.todo .ttag').allTextContents();
  check('shopping tag applied', chipTexts.includes('shopping'));
  check('calls tag applied', chipTexts.includes('calls'));
  check('family tag applied', chipTexts.includes('family'));

  // 4. Tag filter bar: appears, filters, and resets.
  const chips = await page.locator('#tagFilter .fchip').allTextContents();
  check('filter bar shows tags with counts', chips.length >= 3 && chips[0] === 'All');
  await page.locator('#tagFilter .fchip', { hasText: 'shopping' }).click();
  await page.waitForTimeout(200);
  texts = await page.locator('.todo .ttext').allTextContents();
  check('filtering by tag narrows the list', texts.length === 1 && /groceries/i.test(texts[0]));
  await page.locator('#tagFilter .fchip', { hasText: /^All$/ }).click();
  await page.waitForTimeout(200);
  check('All resets the filter', await page.locator('.todo').count() === 3);

  // 5. Tap task → transcript expands; tap again hides.
  await page.locator('.todo .ttext').first().click();
  await page.waitForTimeout(150);
  const tr = await page.locator('.todo .transcript').textContent();
  check('tapping task shows full transcript', /weather is really nice|groceries|birthday/i.test(tr));
  await page.locator('.todo .ttext').first().click();
  await page.waitForTimeout(150);
  check('tapping again hides transcript', await page.locator('.todo .transcript').count() === 0);

  // 6. Quick-added task shows the manual note instead.
  await page.fill('#quickAdd', 'water the plants');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(200);
  const rows = page.locator('.todo', { hasText: 'water the plants' });
  await rows.locator('.ttext').click();
  const tr2 = await rows.locator('.transcript').textContent();
  check('manual task shows manual note', /manually/i.test(tr2));

  // 7. Persistence of tags across reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('nav.tabs button[data-view="today"]');
  check('tags persist after reload', (await page.locator('.todo .ttag').count()) >= 3);

  await page.screenshot({ path: '/tmp/claude-0/-home-user-Market-Research/ffc63541-1c42-508e-9f25-b6e37dea99e5/scratchpad/v6.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail || errors.length ? 1 : 0);
})();
