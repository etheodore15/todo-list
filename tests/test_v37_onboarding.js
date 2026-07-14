// v37: first-run onboarding, cohort self-selection, tailored explainer, revisit.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const fresh = async () => {
    const ctx = await browser.newContext();
    // self-hosted (MANAGED=null) → first run goes straight to onboarding (no auth gate)
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  // ---------- first run shows onboarding ----------
  const A = await fresh();
  check('v37: onboarding shows on first run', await A.locator('#onboarding').isVisible());
  check('v37: dialog semantics present',
    await A.locator('#onboarding[role="dialog"][aria-modal="true"]').count() === 1);
  check('v37: all four cohorts offered', await A.locator('#obChips .ob-chip').count() === 4);
  check('v37: cohorts named', /Focus & ADHD/.test(await A.locator('#obChips').textContent()) &&
    /Co-parenting/.test(await A.locator('#obChips').textContent()) &&
    /Caring for someone/.test(await A.locator('#obChips').textContent()));

  // ---------- multi-select + continue → tailored toolkit ----------
  await A.locator('.ob-chip', { hasText: 'Focus & ADHD' }).click();
  await A.locator('.ob-chip', { hasText: 'Co-parenting' }).click();
  check('v37: selection reflected via aria-pressed',
    await A.locator('.ob-chip[aria-pressed="true"]').count() === 2);
  await A.click('#obContinue');
  await A.waitForTimeout(200);
  check('v37: step 2 shows the toolkit', await A.locator('#obStep2').isVisible());
  const tk = await A.locator('#obToolkit').textContent();
  check('v37: toolkit shows ADHD features', /Break it down/.test(tk) && /Just one thing/.test(tk));
  check('v37: toolkit shows co-parenting features', /Tone check/.test(tk) && /Custody days/.test(tk));
  check('v37: toolkit omits unselected caregiving', !/Doctor briefing/.test(tk));
  check('v37: cohorts persisted on continue',
    JSON.stringify(await A.evaluate(() => store.get('cohorts', []))) === '["adhd","coparenting"]');

  // ---------- next → create-a-space step → solo closes + marks onboarded ----------
  await A.click('#obStart');
  await A.waitForTimeout(150);
  check('v37: step 3 (create a space) shows', await A.locator('#obStep3').isVisible());
  check('v37: space choices offered for chosen cohorts',
    await A.locator('#obSpaceChoices .ob-space').count() >= 1);
  await A.click('#obSolo');
  await A.waitForTimeout(150);
  check('v37: onboarding dismissed', !(await A.locator('#onboarding').isVisible()));
  check('v37: onboarded flag set', await A.evaluate(() => store.get('onboarded', false)) === true);

  // ---------- does not reappear on reload ----------
  await A.reload({ waitUntil: 'load' });
  await A.waitForTimeout(300);
  check('v37: does not reappear after onboarding', !(await A.locator('#onboarding').isVisible()));

  // ---------- settings shows the cohort + can revisit ----------
  await A.click('nav.tabs button[data-view="settings"]');
  check('v37: settings reflects chosen cohorts',
    /Focus & ADHD/.test(await A.locator('#cohortStatus').textContent()));
  await A.click('#cohortBtn');
  check('v37: revisit reopens onboarding', await A.locator('#onboarding').isVisible());
  check('v37: prior selections restored on revisit',
    await A.locator('.ob-chip[aria-pressed="true"]').count() === 2);
  // add caregiving, continue, start
  await A.locator('.ob-chip', { hasText: 'Caring for someone' }).click();
  await A.click('#obContinue');
  await A.click('#obStart');
  await A.waitForTimeout(150);
  await A.click('#obSolo');
  await A.waitForTimeout(150);
  check('v37: updated cohorts saved',
    (await A.evaluate(() => store.get('cohorts', []))).includes('caregiving'));

  // ---------- skip path ----------
  const B = await fresh();
  await B.click('#obSkip');
  await B.waitForTimeout(150);
  check('v37: skip dismisses and marks onboarded',
    !(await B.locator('#onboarding').isVisible()) && await B.evaluate(() => store.get('onboarded', false)));

  // ---------- an action button applies + closes ----------
  const C = await fresh();
  await C.locator('.ob-chip', { hasText: 'Focus & ADHD' }).click();
  await C.click('#obContinue');
  await C.waitForTimeout(150);
  await C.locator('#obToolkit button', { hasText: 'quiet visual mode' }).click();
  await C.waitForTimeout(200);
  check('v37: toolkit action (quiet mode) applied',
    await C.evaluate(() => document.body.classList.contains('quiet')));
  check('v37: toolkit action closed onboarding', !(await C.locator('#onboarding').isVisible()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
