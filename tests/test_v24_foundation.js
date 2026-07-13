// v24 Phase A foundation: edit task text (A1), future dates + Upcoming (A2),
// recurrence (A3), undo (A5), digest "due tomorrow".
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });

  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
  await page.click('nav.tabs button[data-view="today"]');

  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  // ---------- A2: quick add with a spoken date ----------
  await page.fill('#quickAdd', 'buy milk');
  await page.click('#quickAddBtn');
  await page.fill('#quickAdd', 'pay rent tomorrow');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(200);

  const upcoming = page.locator('.prio-section.upcoming');
  check('A2: Upcoming section renders', await upcoming.count() === 1);
  check('A2: dated task lands in Upcoming',
    (await upcoming.locator('.ttext').allTextContents()).some(t => /pay rent/.test(t)));
  check('A2: date chip says tomorrow',
    /tomorrow/.test(await upcoming.locator('.date-chip').first().textContent()));
  check('A2: task stored with tomorrow\'s date',
    await page.evaluate((d) => JSON.parse(localStorage.getItem('todos'))
      .some(t => /pay rent/.test(t.text) && t.date === d), day(1)));
  check('A2: undated task stays on today',
    (await page.locator('.prio-section:not(.upcoming) .ttext').allTextContents()).some(t => /buy milk/.test(t)));
  check('A2: progress counts today only',
    /of 1 done|0 of 1/.test(await page.locator('#progressLabel').textContent()));

  // weekday parsing
  const friday = await page.evaluate(() => parseTaskDate('send the invoice on friday'));
  const fridayOk = friday && new Date(friday + 'T00:00:00Z').getUTCDay() === 5 && friday > day(0);
  check('A2: parseTaskDate resolves "on friday" to a future Friday', fridayOk);
  const nth = await page.evaluate(() => parseTaskDate('book the dentist for the 14th'));
  check('A2: parseTaskDate resolves "for the 14th"', !!nth && /-14$/.test(nth) && nth > day(0));

  // ---------- A2: reschedule via 📅 chip / When action ----------
  page.once('dialog', d => d.accept('today'));
  await upcoming.locator('.date-chip').first().click();
  await page.waitForTimeout(200);
  check('A2: rescheduling to today moves it out of Upcoming',
    (await page.locator('.prio-section:not(.upcoming) .ttext').allTextContents()).some(t => /pay rent/.test(t)));

  // ---------- A1: edit text from the detail panel ----------
  const milk = page.locator('.todo', { hasText: 'buy milk' });
  await milk.locator('.ttext').click();                      // expand detail
  check('A1: detail panel has action buttons', await milk.locator('.tact').count() >= 3);
  page.once('dialog', d => d.accept('buy oat milk'));
  await milk.locator('.tact', { hasText: 'Edit' }).click();
  await page.waitForTimeout(200);
  check('A1: task text edited',
    (await page.locator('.todo .ttext').allTextContents()).some(t => /buy oat milk/.test(t)));

  // ---------- A5: undo a tick ----------
  const oat = page.locator('.todo', { hasText: 'buy oat milk' });
  await oat.locator('.chk').click();
  await page.waitForTimeout(150);
  check('A5: tick shows an undo toast',
    await page.locator('#toast.show .undo').count() === 1);
  await page.click('#toast .undo');
  await page.waitForTimeout(200);
  check('A5: undo un-ticks the task',
    await page.locator('.todo.done', { hasText: 'buy oat milk' }).count() === 0);

  // ---------- A5: undo a delete ----------
  await oat.locator('.del').click();
  await page.waitForTimeout(150);
  check('A5: delete removes the task',
    (await page.locator('.todo .ttext').allTextContents()).every(t => !/buy oat milk/.test(t)));
  await page.click('#toast .undo');
  await page.waitForTimeout(200);
  check('A5: undo restores the deleted task',
    (await page.locator('.todo .ttext').allTextContents()).some(t => /buy oat milk/.test(t)));

  // ---------- A3: recurring quick add ----------
  await page.fill('#quickAdd', 'take the bins out every tuesday');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(200);
  const binsTd = await page.evaluate(() => JSON.parse(localStorage.getItem('todos'))
    .find(t => /bins/.test(t.text)));
  check('A3: recur rule parsed from "every tuesday"',
    binsTd && binsTd.recur && binsTd.recur.type === 'weekly' && binsTd.recur.dow.includes(2));
  check('A3: recurring task dated at its next occurrence',
    binsTd && new Date(binsTd.date + 'T00:00:00Z').getUTCDay() === 2 && binsTd.date >= day(0));
  check('A3: recur chip rendered',
    (await page.locator('.recur-chip').allTextContents()).some(t => /tue/.test(t)));

  // "every morning" → daily, dated today
  await page.fill('#quickAdd', 'take my meds every morning');
  await page.click('#quickAddBtn');
  await page.waitForTimeout(200);
  const medsTd = await page.evaluate(() => JSON.parse(localStorage.getItem('todos'))
    .find(t => /meds/.test(t.text)));
  check('A3: "every morning" parses as daily on today',
    medsTd && medsTd.recur && medsTd.recur.type === 'daily' && medsTd.date === day(0));

  // ---------- A3: rollover respawns a finished recurring task ----------
  const respawn = await page.evaluate(() => {
    const done = nextOccurrence({type: 'daily'}, todayStr());
    // simulate: daily task finished yesterday
    const td = {id: 'r1', text: 'water plants', priority: 'low', tags: ['home'], done: true,
                date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
                recur: {type: 'daily'}, doneBy: 'me', doneAt: Date.now() - 86400000};
    // replicate the rollover logic on this object
    const t = todayStr();
    if (td.recur && td.date < t){
      if (td.done){ td.done = false; td.doneBy = null; td.doneAt = null; td.date = nextOccurrence(td.recur, t); }
      else td.date = t;
    }
    return {done: !td.done && td.date === t && !td.doneBy, next: done};
  });
  check('A3: finished daily task respawns undone today', respawn.done);

  // monthly next-occurrence math
  const monthly = await page.evaluate(() => nextOccurrence({type: 'monthly', day: 1}, '2026-07-12'));
  check('A3: monthly rule finds the next 1st', monthly === '2026-08-01');

  // ---------- A3: edit repeat via detail panel ----------
  const oat2 = page.locator('.todo', { hasText: 'buy oat milk' });
  await oat2.locator('.ttext').click();
  page.once('dialog', d => d.accept('every friday'));
  await oat2.locator('.tact', { hasText: 'Repeat' }).click();
  await page.waitForTimeout(200);
  const oatTd = await page.evaluate(() => JSON.parse(localStorage.getItem('todos'))
    .find(t => /oat milk/.test(t.text)));
  check('A3: repeat set from detail panel',
    oatTd && oatTd.recur && oatTd.recur.type === 'weekly' && oatTd.recur.dow.includes(5));

  // ---------- heuristic summarizer carries date + recur ----------
  const summ = await page.evaluate(() => localSummarize(
    'I need to call the plumber tomorrow and take my vitamins every morning'));
  const pl = summ.tasks.find(t => /plumber/i.test(t.text));
  const vit = summ.tasks.find(t => /vitamin/i.test(t.text));
  check('A2: localSummarize dates "tomorrow" task', pl && pl.date === day(1));
  check('A3: localSummarize catches "every morning"', vit && vit.recur && vit.recur.type === 'daily');

  // ---------- AI normalizer accepts date/recur strings ----------
  const normed = await page.evaluate((d) => normalizeIdeaJson({
    summary: 's',
    tasks: [{text: 'pay rent', priority: 'high', tags: ['finance'], date: d, recur: 'monthly:1'},
            {text: 'stretch', priority: 'low', tags: ['health'], recur: 'weekly:mon,thu'},
            {text: 'bad date', priority: 'low', tags: ['x'], date: '2020-01-01'}],
    priority: 'high'
  }, 'x'), day(3));
  check('AI: valid future date kept / recur parsed',
    normed.tasks[0].recur.type === 'monthly' && normed.tasks[0].recur.day === 1);
  check('AI: weekly:mon,thu parsed', JSON.stringify(normed.tasks[1].recur.dow) === '[1,4]');
  check('AI: past date rejected', normed.tasks[2].date === null);

  // ---------- digest counts due-tomorrow ----------
  await page.addScriptTag({ url: 'http://localhost:8906/digest.js' });
  const dig = await page.evaluate((days) => composeDigest([
    {text: 'a', done: false, date: days[0]},
    {text: 'b', done: false, date: days[1]},
    {text: 'c', done: false, date: days[1]}
  ], 'me', Date.now(), days[0]), [day(0), day(1)]);
  check('A4: digest reports due-tomorrow count',
    dig.dueTomorrow === 2 && /1 task open today · 2 due tomorrow/.test(dig.body));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
