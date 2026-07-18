// v90: recurrence vocabulary + N-way money (persona study #12, #8, #9).
//  #12 — fortnightly ("every second Thursday"), month-multiples ("every three
//        months", "quarterly") and sub-daily ("every three hours", tick
//        respawns the next slot) recurrences.
//  #8  — N-way settlement lines + per-space split ratio (no more 2-payer,
//        50/50-only balance maths).
//  #9  — the ledger and an expenses report section for family-type spaces.
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
    await p.addInitScript(init || (() => localStorage.setItem('onboarded', 'true')));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  };

  // ================= #12: recurrence vocabulary =================
  const A = await mk();
  const r = await A.evaluate(() => ({
    fortnight: parseRecur('Pay the mortgage every second Thursday'),
    fortnight2: parseRecur('invoice run every fortnight'),
    quarterly: parseRecur('Ray skin check every three months'),
    quarterly2: parseRecur('service the pumps quarterly'),
    hours: parseRecur('Feed Ivy every three hours'),
    weeklyStill: parseRecur('bins every Tuesday'),
    dailyStill: parseRecur('meds every morning'),
    labels: [recurLabel({type: 'fortnightly', dow: 4, anchor: '2026-07-23'}),
             recurLabel({type: 'months', every: 3, day: 18}),
             recurLabel({type: 'hours', every: 3})],
  }));
  check('#12 "every second Thursday" → fortnightly on Thursday',
    r.fortnight && r.fortnight.type === 'fortnightly' && r.fortnight.dow === 4 && !!r.fortnight.anchor, JSON.stringify(r.fortnight));
  check('#12 "every fortnight" → fortnightly', r.fortnight2 && r.fortnight2.type === 'fortnightly');
  check('#12 "every three months" → month-multiple', r.quarterly && r.quarterly.type === 'months' && r.quarterly.every === 3, JSON.stringify(r.quarterly));
  check('#12 "quarterly" → every 3 months', r.quarterly2 && r.quarterly2.type === 'months' && r.quarterly2.every === 3);
  check('#12 "every three hours" → sub-daily', r.hours && r.hours.type === 'hours' && r.hours.every === 3, JSON.stringify(r.hours));
  check('#12 weekly and daily unchanged', r.weeklyStill.type === 'weekly' && r.dailyStill.type === 'daily');
  check('#12 labels read honestly', /fortnightly \(thu\)/i.test(r.labels[0]) && /every 3 months/.test(r.labels[1]) && /every 3 h/.test(r.labels[2]), JSON.stringify(r.labels));

  const occ = await A.evaluate(() => {
    const f = nextOccurrence({type: 'fortnightly', dow: 4, anchor: '2026-07-23'}, '2026-07-24');
    const f0 = nextOccurrence({type: 'fortnightly', dow: 4, anchor: '2026-07-23'}, '2026-07-23');
    const q = nextOccurrence({type: 'months', every: 3, day: 31, anchorMonth: 2026 * 12 + 6}, '2026-08-01');
    const q0 = nextOccurrence({type: 'months', every: 3, day: 15, anchorMonth: 2026 * 12 + 6}, '2026-07-15');
    return {f, f0, q, q0};
  });
  check('#12 fortnight steps 14 days from the anchor', occ.f0 === '2026-07-23' && occ.f === '2026-08-06', JSON.stringify(occ));
  check('#12 quarterly jumps a whole quarter (day clamped in short months)',
    occ.q0 === '2026-07-15' && occ.q === '2026-10-31', JSON.stringify(occ));

  // full pipeline: the FIFO capture that started this finding
  await A.click('nav.tabs button[data-view="capture"]');
  await A.fill('#liveText', 'Pay the mortgage every second Thursday');
  await A.click('#saveIdeaBtn');
  await A.waitForFunction(() => !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, { timeout: 20000 });
  const mort = await A.evaluate(() => JSON.parse(localStorage.getItem('todos') || '[]').find(t => /mortgage/i.test(t.text)));
  check('#12 Brendan\'s mortgage capture carries a fortnightly rule',
    mort && mort.recur && mort.recur.type === 'fortnightly', JSON.stringify(mort && mort.recur));

  // sub-daily respawn: tick "Feed Ivy" → next slot 3 h on
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    const t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('todos', JSON.stringify([
      {id: 'ivy1', text: 'Feed Ivy', priority: 'medium', tags: [], done: false, date: t,
       time: '08:00', recur: {type: 'hours', every: 3}}]));
  });
  await B.click('nav.tabs button[data-view="today"]');
  await B.locator('.todo', { hasText: 'Feed Ivy' }).locator('.chk').click();
  await B.waitForTimeout(2200);   // the respawn fires after ~1.4 s
  const ivy = await B.evaluate(() => JSON.parse(localStorage.getItem('todos') || '[]').find(t => /Feed Ivy/.test(t.text)));
  const ivyEvents = await B.evaluate(() => JSON.parse(localStorage.getItem('events') || '[]').filter(e => e.kind === 'ticked' && /Ivy/.test(e.text)).length);
  check('#12 ticked feed respawns unticked at the NEXT slot (11:00)',
    ivy && !ivy.done && ivy.time === '11:00', JSON.stringify(ivy && {done: ivy.done, time: ivy.time}));
  check('#12 …and the tick itself stays in the record (the feed log)', ivyEvents === 1, String(ivyEvents));

  // ================= #8: N-way settlement + split ratio =================
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Ari'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-ez', name: 'Ezra', type: 'coparenting', cfg: null}]));
    const now = Date.now(), t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('todos', JSON.stringify([
      {id: 'x1', text: 'Kinder fees', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Ari', date: t, space: 'hh-ez', amount: 120, expenseBy: 'Ari', expenseAt: now},
      {id: 'x2', text: 'Shoes', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Dana', date: t, space: 'hh-ez', amount: 75, expenseBy: 'Dana', expenseAt: now},
      {id: 'x3', text: 'Swimming', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Sipho', date: t, space: 'hh-ez', amount: 45, expenseBy: 'Sipho', expenseAt: now}]));
  });
  const html3 = await C.evaluate(() => coparentReportHtml(spacesList()[0]));
  check('#8 three payers get settlement lines (not silence)',
    /Sipho owes Ari/.test(html3) && /\$35\.00/.test(html3), html3.slice(html3.indexOf('Expenses'), html3.indexOf('Expenses') + 400));
  check('#8 …and the second debtor settles too', /Dana owes Ari/.test(html3) && /\$5\.00/.test(html3));
  check('#8 fine print no longer claims 50/50', !/assumes a 50\/50/.test(html3) && /equal split/.test(html3));

  // configured ratio: Zoe 70 / Jay 30
  const D = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Zoe'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-luna', name: 'Luna', type: 'coparenting', cfg: null}]));
    const now = Date.now(), t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('todos', JSON.stringify([
      {id: 'z1', text: 'Daycare', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Zoe', date: t, space: 'hh-luna', amount: 300, expenseBy: 'Zoe', expenseAt: now},
      {id: 'z2', text: 'Swim lessons', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Jay', date: t, space: 'hh-luna', amount: 60, expenseBy: 'Jay', expenseAt: now}]));
    localStorage.setItem('splitRatio', JSON.stringify({'hh-luna': {zoe: 70, jay: 30}}));
  });
  const htmlZ = await D.evaluate(() => coparentReportHtml(spacesList()[0]));
  check('#8 70/30 ratio drives the balance ($360 × 30% − $60 = $48)',
    /Jay owes Zoe/.test(htmlZ) && /\$48\.00/.test(htmlZ), htmlZ.slice(htmlZ.indexOf('paid')));
  check('#8 fine print states the configured split', /Zoe 70% \/ Jay 30%/.test(htmlZ));

  // the split dialog end-to-end in the ledger
  await D.evaluate(() => openLedger(spacesList()[0]));
  await D.waitForTimeout(400);
  check('#8 ledger shows the configured split', /split Zoe 70% \/ Jay 30%/.test(await D.locator('#ledgerTotals').textContent()));
  await D.locator('#ledgerTotals .custody-set').click();
  await D.fill('#inputField', 'Zoe 60, Jay 40');
  await D.click('#inputSave');
  await D.waitForTimeout(300);
  check('#8 editing the split re-balances live', /split Zoe 60% \/ Jay 40%/.test(await D.locator('#ledgerTotals').textContent()));
  check('#8 the split change is an append-only record entry', await D.evaluate(() =>
    JSON.parse(localStorage.getItem('events') || '[]').some(e => e.kind === 'split' && /Zoe 60%/.test(e.text))));
  // a nonsense ratio is refused
  await D.locator('#ledgerTotals .custody-set').click();
  await D.fill('#inputField', 'Zoe 80, Jay 40');
  await D.click('#inputSave');
  await D.waitForTimeout(300);
  check('#8 percentages must add to 100', /split Zoe 60% \/ Jay 40%/.test(await D.locator('#ledgerTotals').textContent()));

  // ================= #9: the ledger reaches family spaces =================
  const E = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Kai'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-errol', name: '12 Errol St', type: 'family', cfg: null}]));
    const now = Date.now(), t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('todos', JSON.stringify([
      {id: 'k1', text: 'Carpet cleaner hire', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Kai', date: t, space: 'hh-errol', amount: 180, expenseBy: 'Kai', expenseAt: now},
      {id: 'k2', text: 'Cleaning supplies', priority: 'medium', tags: [], done: true, doneAt: now, doneBy: 'Beth', date: t, space: 'hh-errol', amount: 60, expenseBy: 'Beth', expenseAt: now},
      {id: 'k3', text: 'Oven cleaner', priority: 'low', tags: [], done: true, doneAt: now, doneBy: 'Sunny', date: t, space: 'hh-errol', amount: 30, expenseBy: 'Sunny', expenseAt: now}]));
  });
  await E.click('nav.tabs button[data-view="ideas"]');
  await E.waitForTimeout(300);
  check('#9 the Journal Records row offers a Ledger for the share-house',
    await E.locator('#jrnRecords .rec-row .btn', { hasText: 'Ledger' }).count() === 1);
  await E.locator('#jrnRecords .rec-row .btn', { hasText: 'Ledger' }).click();
  await E.waitForTimeout(400);
  const ledgTxt = await E.locator('#ledgerTotals').textContent();
  check('#9 three flatmates settle N-way ($90 each: Sunny→Kai $60, Beth→Kai $30)',
    /Sunny owes Kai \$60\.00/.test(ledgTxt) && /Beth owes Kai \$30\.00/.test(ledgTxt), ledgTxt);
  await E.click('#ledgerClose').catch(() => E.keyboard.press('Escape'));
  const famRep = await E.evaluate(() => familyReportHtml(spacesList()[0]));
  check('#9 the family week report gains the expenses section',
    /Expenses — last 4 weeks/.test(famRep) && /\$270\.00/.test(famRep), famRep.slice(0, 200));
  check('#9 …with settlement lines', /Sunny owes Kai/.test(famRep));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
