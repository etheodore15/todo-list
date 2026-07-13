const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = 0, fail = 0;
  const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name); cond ? pass++ : fail++; };

  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });

  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  // Reported bug: multi-task split where only one task got tags.
  await page.fill('#liveText', "I need to book the car in for a service and I should buy a birthday present for Lulu");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const rows = await page.locator('.todo').count();
  check('two tasks split out', rows === 2);
  for (let i = 0; i < rows; i++){
    const tagCount = await page.locator('.todo').nth(i).locator('.ttag').count();
    const text = await page.locator('.todo').nth(i).locator('.ttext').textContent();
    check(`task ${i + 1} has tags ("${text.slice(0, 30)}…": ${tagCount})`, tagCount >= 1);
  }

  // Uncategorizable task still gets the general tag.
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', "I need to arrange that thing for Steve");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const genRow = page.locator('.todo', { hasText: 'Steve' });
  const genTags = await genRow.locator('.ttag').allTextContents();
  check('unmatched task gets general tag', genTags.includes('general'));

  // New categories work.
  const carRow = page.locator('.todo', { hasText: 'car' });
  const carTags = await carRow.locator('.ttag').allTextContents();
  check('car category detected', carTags.includes('car'));

  // Every task on the board has at least one tag.
  const all = await page.locator('.todo').count();
  let allTagged = true;
  for (let i = 0; i < all; i++){
    if (await page.locator('.todo').nth(i).locator('.ttag').count() < 1) allTagged = false;
  }
  check('every task has at least one tag', allTagged);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail || errors.length ? 1 : 0);
})();
