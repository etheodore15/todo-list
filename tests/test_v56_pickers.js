// v56: replace native prompt() editors with in-app sheets — a date picker
// (quick chips + <input type="date">), a repeat sheet (mode chips + weekday
// picker + day-of-month <select>), and a generic input sheet for text/tags.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  const dialogs = [];

  const mk = async () => {
    const ctx = await browser.newContext();
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', e => errors.push(e.message));
    // if any native prompt/confirm fires, record it (should NEVER happen now) and dismiss
    page.on('dialog', d => { dialogs.push(d.type()); d.dismiss(); });
    const t = new Date().toISOString().slice(0, 10);
    await page.addInitScript((t) => {
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('todos', JSON.stringify([
        {id: 'a', text: 'Plan the trip', priority: 'medium', tags: ['home'], done: false, date: t, energy: 'medium', minutes: 20}]));
    }, t);
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.click('nav.tabs button[data-view="today"]');
    await page.waitForTimeout(200);
    return page;
  };

  const P = await mk();
  const dateOf = () => P.evaluate(() => JSON.parse(localStorage.getItem('todos'))[0].date);
  const recurOf = () => P.evaluate(() => JSON.parse(localStorage.getItem('todos'))[0].recur);
  const textOf = () => P.evaluate(() => JSON.parse(localStorage.getItem('todos'))[0].text);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // ---------- date sheet ----------
  await P.evaluate(() => editDate(todos[0]));
  await P.waitForTimeout(150);
  check('v56: date sheet opens with quick chips + a native date input',
    await P.locator('#dateSheet').isVisible() &&
    await P.locator('#dateInput').getAttribute('type') === 'date' &&
    await P.locator('#dateQuick .pick-chip').count() === 5);
  await P.locator('#dateQuick .pick-chip[data-d="tomorrow"]').click();
  await P.waitForTimeout(150);
  check('v56: “Tomorrow” chip reschedules the task', (await dateOf()) === tomorrow);
  check('v56: date sheet closes after picking', !(await P.locator('#dateSheet').isVisible()));

  // native date input path
  await P.evaluate(() => editDate(todos[0]));
  await P.waitForTimeout(120);
  const pick = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await P.fill('#dateInput', pick);
  await P.click('#dateSave');
  await P.waitForTimeout(150);
  check('v56: native date input sets the chosen date', (await dateOf()) === pick);

  // ---------- repeat sheet ----------
  await P.evaluate(() => editRecur(todos[0]));
  await P.waitForTimeout(150);
  check('v56: repeat sheet opens with mode chips', await P.locator('#repeatMode .pick-chip').count() === 4);
  await P.locator('#repeatMode .pick-chip[data-r="weekly"]').click();
  await P.waitForTimeout(100);
  check('v56: choosing Weekly reveals the weekday picker', await P.locator('#repeatDays').isVisible());
  await P.locator('#repeatDays .pick-day', { hasText: 'Mon' }).click();
  await P.locator('#repeatDays .pick-day', { hasText: 'Thu' }).click();
  await P.click('#repeatSave');
  await P.waitForTimeout(150);
  const wk = await recurOf();
  check('v56: weekly Mon/Thu recurrence saved', wk && wk.type === 'weekly' && wk.dow.includes(1) && wk.dow.includes(4));

  // monthly via <select>
  await P.evaluate(() => editRecur(todos[0]));
  await P.waitForTimeout(120);
  await P.locator('#repeatMode .pick-chip[data-r="monthly"]').click();
  await P.waitForTimeout(80);
  check('v56: Monthly reveals a day-of-month <select>',
    await P.locator('#repeatMonthWrap').isVisible() &&
    await P.evaluate(() => document.getElementById('repeatMonthDay').tagName) === 'SELECT');
  await P.selectOption('#repeatMonthDay', '15');
  await P.click('#repeatSave');
  await P.waitForTimeout(150);
  const mo = await recurOf();
  check('v56: monthly-on-the-15th saved via the select', mo && mo.type === 'monthly' && mo.day === 15);

  // "Doesn't repeat" clears it
  await P.evaluate(() => editRecur(todos[0]));
  await P.waitForTimeout(120);
  await P.locator('#repeatMode .pick-chip[data-r="none"]').click();
  await P.click('#repeatSave');
  await P.waitForTimeout(150);
  check('v56: “Doesn’t repeat” clears recurrence', (await recurOf()) == null);

  // ---------- text input sheet ----------
  // editText is async (awaits the sheet) — fire it, don't await, or evaluate deadlocks
  await P.evaluate(() => { editText(todos[0]); });
  await P.waitForTimeout(150);
  check('v56: edit-text uses an in-app input sheet (no native prompt)', await P.locator('#inputSheet').isVisible());
  await P.fill('#inputField', 'Plan the summer trip');
  await P.click('#inputSave');
  await P.waitForTimeout(150);
  check('v56: edited text is saved', (await textOf()) === 'Plan the summer trip');

  // ---------- the big one: NO native dialogs were ever triggered ----------
  check('v56: no native prompt()/confirm() dialogs fired', dialogs.length === 0);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
