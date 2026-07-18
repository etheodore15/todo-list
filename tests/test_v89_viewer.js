// v89: read-only roles can't phantom-write (persona study #6 — viewer-vera).
// A circle viewer could aim a task capture at the circle: the task was created
// locally, stamped with the circle id, sync would be rejected by the rules,
// and she alone saw a "shared" task nobody else ever would. Now every path
// that aims a task at a space refuses read-only spaces: the capture chips
// (disabled chip that EXPLAINS), the capture default, quick-add from the
// space's own Today view, and the move-between-spaces sheet.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' — ' + (extra || ''))); cond ? pass++ : fail++; };
  const errors = [];

  const mk = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  };

  // Vera: viewer in her granddaughter's circle, plus a family space she CAN write to
  const VERA = () => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Vera'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-mia', name: "Mia's circle", type: 'circle', role: 'viewer', cfg: null},
      {hid: 'hh-fam', name: 'Family', type: 'family', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-mia'));
  };

  // ---------- 1. capture chips ----------
  const A = await mk(VERA);
  await A.click('nav.tabs button[data-view="capture"]');
  const chip = A.locator('#destChips .fchip', { hasText: "Mia's circle" });
  check('the read-only space still appears as a chip', await chip.count() === 1);
  check('…but disabled, announced to AT', await chip.getAttribute('aria-disabled') === 'true');
  await chip.click({ force: true });   // AT users can still activate it; force past Playwright's actionability
  await A.waitForTimeout(250);
  check('tapping it explains the viewer role instead of selecting',
    await A.evaluate(() => document.body.textContent.includes('only members with a writing role')));
  check('the writable family space chip still works',
    await A.locator('#destChips .fchip:not([aria-disabled])', { hasText: 'Family' }).count() === 1);

  // defaultSpace pointed at the circle — the EFFECTIVE destination must not be it
  const eff = await A.evaluate(() => captureDestVal());
  check('capture default never resolves to the read-only space', eff === null, String(eff));

  // full pipeline: capture with the circle as defaultSpace → task stays private
  await A.fill('#liveText', 'Make Mia a blue cardigan before winter');
  await A.click('#saveIdeaBtn');
  await A.waitForFunction(() => !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, { timeout: 20000 });
  const t1 = await A.evaluate(() => JSON.parse(localStorage.getItem('todos') || '[]').find(x => /cardigan/i.test(x.text)));
  check('the capture became a task', !!t1);
  check('…and it is PRIVATE, not phantom-stamped with the circle', t1 && !t1.space, JSON.stringify(t1 && t1.space));

  // ---------- 2. quick-add while VIEWING the circle on Today ----------
  await A.click('nav.tabs button[data-view="today"]');
  await A.waitForTimeout(200);
  const stamped = await A.evaluate(() => { activeSpace = 'hh-mia'; return newTaskSpace(); });
  check('quick-add from the circle view stays private', stamped === null, String(stamped));

  // ---------- 3. move-between-spaces sheet ----------
  await A.evaluate(() => { activeSpace = 'all'; renderTodos(); const td = todos.find(x => /cardigan/i.test(x.text)); openScopeSheet(td); });
  await A.waitForTimeout(200);
  const sheetText = await A.locator('#scopeSpaces').textContent();
  check('the circle is not offered as a move target', !/Mia/.test(sheetText), sheetText);
  // exactly one writable space → the sheet offers it via the named share button
  check('the writable space IS offered', await A.evaluate(() => {
    const b = document.getElementById('scopeFamily');
    return b && b.style.display !== 'none' && /Family/.test(b.textContent);
  }));

  // ---------- 4. a WORKER in the same circle keeps full write access ----------
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Jade'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-mia', name: "Mia's circle", type: 'circle', role: 'worker', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-mia'));
  });
  await B.click('nav.tabs button[data-view="capture"]');
  const wchip = B.locator('#destChips .fchip', { hasText: "Mia's circle" });
  check('worker: circle chip is enabled', await wchip.getAttribute('aria-disabled') !== 'true');
  await B.fill('#liveText', 'Bring the visual timetable printout next Thursday');
  await B.click('#saveIdeaBtn');
  await B.waitForFunction(() => !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, { timeout: 20000 });
  const t2 = await B.evaluate(() => JSON.parse(localStorage.getItem('todos') || '[]').find(x => /timetable/i.test(x.text)));
  check('worker: capture lands IN the circle', t2 && t2.space === 'hh-mia', JSON.stringify(t2 && t2.space));

  // non-circle spaces are never affected by the guard
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-f', name: 'Home', type: 'family', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-f'));
  });
  check('family space untouched by the guard',
    await C.evaluate(() => captureDestVal()) === 'hh-f');

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
