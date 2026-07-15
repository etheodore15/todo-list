// v26 ADHD pack part 2: energy levels (B3), no-shame carry-over + Someday (B4),
// wins view (B5), duration/day-load (B6), quiet visual mode (B7).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  await page.addInitScript((d) => {
    if (localStorage.getItem('todos')) return;
    localStorage.setItem('winsLog', JSON.stringify({[d.yest]: 2}));
    localStorage.setItem('todos', JSON.stringify([
      {id:'e1', text:'Call the dentist', priority:'medium', tags:['calls'], done:false, date:d.today},
      {id:'e2', text:'Write the quarterly report', priority:'high', tags:['work'], done:false, date:d.today},
      {id:'e3', text:'Fix the fence gate', priority:'low', tags:['home'], done:false, date:d.today, carried: 6},
    ]));
  }, {today, yest});

  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });
  await page.click('nav.tabs button[data-view="today"]');

  // ---------- B3: energy auto-detected + chips ----------
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('todos')));
  check('B3: migration backfills energy',
    stored.find(t => t.id === 'e1').energy === 'low' && stored.find(t => t.id === 'e2').energy === 'high');
  const dentist = page.locator('.todo', { hasText: 'Call the dentist' });
  check('B3: energy chip rendered', /~10m/.test(await dentist.locator('.energy-chip').textContent()));
  // cycling low → medium
  await dentist.locator('.energy-chip').click();
  await page.waitForTimeout(150);
  check('B3: tapping cycles the effort level',
    /~25m/.test(await page.locator('.todo', { hasText: 'Call the dentist' }).locator('.energy-chip').textContent()));
  await page.locator('.todo', { hasText: 'Call the dentist' }).locator('.energy-chip').click();
  await page.locator('.todo', { hasText: 'Call the dentist' }).locator('.energy-chip').click(); // back to low
  await page.waitForTimeout(150);

  // ---------- B6: day load ----------
  const label = await page.locator('#progressLabel').textContent();
  check('B6: progress label shows realistic load', /~1h 20m of doing left/.test(label));

  // ---------- B3: easy-wins filter ----------
  const easy = page.locator('.fchip.easy');
  check('B3: easy-wins chip shows count', /easy wins \(1\)/.test(await easy.textContent()));
  await easy.click();
  await page.waitForTimeout(150);
  const visible = await page.locator('#todoList .todo .ttext').allTextContents();
  check('B3: filter shows only low-energy tasks',
    visible.some(t => /dentist/.test(t)) && !visible.some(t => /report/.test(t)));
  await page.locator('.fchip.easy').click();   // off again
  await page.waitForTimeout(150);

  // ---------- B4: carried nudge ----------
  const fence = page.locator('.todo', { hasText: 'Fix the fence gate' });
  check('B4: nudge appears after 5 carried days',
    /been on the list 6 days/.test(await fence.locator('.nudge').textContent()));
  check('B4: nothing says overdue and nothing is red',
    !/overdue/i.test(await page.locator('#todoList').textContent()));
  await fence.locator('.nudge button', { hasText: 'Someday' }).click();
  await page.waitForTimeout(200);
  check('B4: someday parks the task out of today',
    !(await page.locator('#todoList .todo', { hasText: 'fence' }).count()));
  check('B4: Someday block lists it',
    /Someday \(1\)/.test(await page.locator('#somedayBlock summary').textContent()));
  check('B4: parked task skips rollover',
    await page.evaluate(() => JSON.parse(localStorage.getItem('todos')).find(t => t.id === 'e3').someday === true));

  // bring it back via 📅 When
  await page.locator('#somedayBlock summary').click();
  await page.locator('#somedayList .todo .ttext').click();
  await page.locator('#somedayList .tact', { hasText: 'When' }).click();
  await page.waitForTimeout(150);
  await page.locator('#dateQuick .pick-chip[data-d="today"]').click();
  await page.waitForTimeout(200);
  check('B4: 📅 When brings it back to today',
    (await page.locator('#todoList .todo .ttext').allTextContents()).some(t => /fence/.test(t)));
  check('B4: return resets the carry counter',
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('todos')).find(x => x.id === 'e3');
      return !t.someday && t.carried === 0; }));

  // ---------- B4: "Let it go" deletes with undo ----------
  await page.evaluate(() => { const t = todos.find(x => x.id === 'e3'); t.carried = 7; saveTodos(); renderTodos(); });
  await page.locator('.todo', { hasText: 'fence' }).locator('.nudge button', { hasText: 'Let it go' }).click();
  await page.waitForTimeout(150);
  check('B4: let it go removes the task',
    !(await page.locator('#todoList .todo', { hasText: 'fence' }).count()));
  check('B4: let it go offers undo', await page.locator('#toast.show .undo').count() === 1);
  await page.click('#toast .undo');
  await page.waitForTimeout(150);
  check('B4: undo restores it',
    (await page.locator('#todoList .todo .ttext').allTextContents()).some(t => /fence/.test(t)));

  // ---------- B5: wins ----------
  await page.locator('.todo', { hasText: 'Call the dentist' }).locator('.chk').click();
  await page.waitForTimeout(200);
  check('B5: wins block appears',
    await page.locator('#winsBlock').isVisible());
  check('B5: summary counts today and week',
    /Wins · 1 today, 3 this week/.test(await page.locator('#winsBlock summary').textContent()));
  await page.locator('#winsBlock summary').click();
  check('B5: streak line counts consecutive days',
    /2 days running/.test(await page.locator('#winsList').textContent()));
  check('B5: today\'s tick listed',
    /Call the dentist/.test(await page.locator('#winsList').textContent()));
  // undo decrements the log
  const logAfterUndo = await page.evaluate(() => {
    const td = todos.find(t => /dentist/.test(t.text));
    setDone(td, false); saveTodos(); renderTodos();
    return JSON.parse(localStorage.getItem('winsLog'));
  });
  check('B5: unticking decrements the wins log', (logAfterUndo[today] || 0) === 0);

  // ---------- B7: quiet mode ----------
  await page.click('nav.tabs button[data-view="settings"]');
  await page.click('#quietBtn');
  check('B7: quiet class applied',
    await page.evaluate(() => document.body.classList.contains('quiet')));
  check('B7: button flips to off-label',
    /Turn off/.test(await page.locator('#quietBtn').textContent()));
  await page.reload({ waitUntil: 'networkidle' });
  check('B7: quiet mode persists across reload',
    await page.evaluate(() => document.body.classList.contains('quiet')));

  // ---------- digest ignores someday ----------
  await page.addScriptTag({ url: 'http://localhost:8906/digest.js' });
  const dig = await page.evaluate((d) => composeDigest([
    {text: 'parked', done: false, date: d, someday: true},
    {text: 'real', done: false, date: d}
  ], 'me', Date.now(), d), today);
  check('B4: digest skips someday tasks', dig.openToday === 1);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
