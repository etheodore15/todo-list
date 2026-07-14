// v38 accessibility: live regions, dialog semantics, Escape-to-close,
// focus-visible + reduced-motion CSS, labelled inputs, nav semantics.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // seed a space so we can open its dialogs; skip onboarding
  await page.addInitScript(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('alex'));
    localStorage.setItem('members', JSON.stringify(['alex', 'sam']));
    localStorage.setItem('spaces', JSON.stringify([
      {hid:'hh-cop', name:'Co-parenting', type:'coparenting', cfg:{apiKey:'k', projectId:'p'}}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-cop'));
  });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // ---------- live regions ----------
  check('a11y: toast is a polite live region',
    await page.locator('#toast[role="status"][aria-live="polite"]').count() === 1);
  check('a11y: mic hint announces status',
    await page.locator('#micHint[aria-live="polite"]').count() === 1);

  // ---------- nav semantics ----------
  check('a11y: nav is labelled', await page.locator('nav.tabs[aria-label]').count() === 1);
  check('a11y: nav emoji are decorative (aria-hidden)',
    await page.locator('nav.tabs .ico[aria-hidden="true"]').count() === 4);
  await page.click('nav.tabs button[data-view="today"]');
  check('a11y: current tab exposes aria-current',
    await page.locator('nav.tabs button[data-view="today"][aria-current="page"]').count() === 1 &&
    await page.locator('nav.tabs button[data-view="capture"][aria-current="page"]').count() === 0);

  // ---------- labelled inputs ----------
  const unlabelled = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('input, textarea, select')]
      .filter(el => el.type !== 'checkbox' && el.type !== 'file' && el.type !== 'radio');
    return fields.filter(el => !el.getAttribute('aria-label') && !el.labels?.length && !el.id?.match(/^(custodyAlt)$/)).map(el => el.id);
  });
  check('a11y: all text inputs have an accessible name', unlabelled.length === 0);

  // ---------- dialog semantics on sheets ----------
  await page.fill('#quickAdd', 'swap the weekend');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(200);
  await page.locator('.todo', { hasText: 'swap the weekend' }).locator('.scope-chip').click();
  check('a11y: scope sheet is a modal dialog',
    await page.locator('#scopeSheet[role="dialog"][aria-modal="true"][aria-label]').count() === 1);

  // ---------- Escape closes the open dialog ----------
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('a11y: Escape closes the scope sheet',
    await page.evaluate(() => getComputedStyle(document.getElementById('scopeSheet')).display === 'none'));

  // Escape closes a full-screen overlay too (Just One Thing)
  await page.click('#focusBtn');
  await page.waitForTimeout(150);
  check('a11y: focus overlay opens as a dialog',
    await page.locator('#focusOverlay[role="dialog"][aria-modal="true"]').count() === 1 &&
    await page.evaluate(() => getComputedStyle(document.getElementById('focusOverlay')).display !== 'none'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('a11y: Escape closes the focus overlay',
    await page.evaluate(() => getComputedStyle(document.getElementById('focusOverlay')).display === 'none'));

  // ---------- CSS: focus-visible + reduced-motion present ----------
  const css = await page.evaluate(() => {
    let all = '';
    for (const sheet of document.styleSheets){
      try { for (const r of sheet.cssRules) all += r.cssText; } catch(e){}
    }
    return all;
  });
  check('a11y: focus-visible outline rule present', /focus-visible/.test(css) && /outline/.test(css));
  check('a11y: prefers-reduced-motion honoured', /prefers-reduced-motion/.test(css));

  // ---------- onboarding dialog keyboard-dismissable ----------
  const bctx = await browser.newContext();
  // self-hosted (MANAGED=null) → first run is onboarding directly (no auth gate)
  await bctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
  const B = await bctx.newPage();
  B.on('pageerror', e => errors.push(e.message));
  await B.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await B.waitForTimeout(300);
  check('a11y: onboarding shows for a new user', await B.locator('#onboarding').isVisible());
  await B.keyboard.press('Escape');
  await B.waitForTimeout(150);
  check('a11y: Escape dismisses onboarding',
    await B.evaluate(() => getComputedStyle(document.getElementById('onboarding')).display === 'none'));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
