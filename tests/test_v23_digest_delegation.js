const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c?'PASS':'FAIL')+': '+n); c?pass++:fail++; };
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  // members for delegation
  await page.click('nav.tabs button[data-view="settings"]');
  await page.fill('#membersInput', 'Emile, Lulu');
  await page.click('#saveMembersBtn');

  // 1. heuristic voice delegation: "remind Lulu to ..." → assignee lulu
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', "I need to remind Lulu to hang out the washing and I should pay the water bill");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const assignees = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('todos')).map(t => ({text: t.text, a: t.assignees || []})));
  console.log(JSON.stringify(assignees));
  const washing = assignees.find(t => /washing/i.test(t.text));
  const bill = assignees.find(t => /water bill/i.test(t.text));
  check('delegated task assigned to lulu', washing && washing.a.includes('lulu'));
  check('own task not assigned', bill && bill.a.length === 0);
  const chip = await page.locator('.todo', { hasText: 'washing' }).locator('.scope-chip').textContent();
  check('scope chip shows → lulu', /→ lulu/.test(chip));

  // 2. prompt tells the AI about delegation
  const prompt = await page.evaluate(() => buildIdeaPrompt('x'));
  check('prompt includes delegation rule', /DELEGATES a task to a member/.test(prompt));

  // 3. digest pure functions (shared with the service worker)
  await page.addScriptTag({ url: 'digest.js' });
  const digest = await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    const items = [
      {text: 'a', done: false, date: today, assignees: [], createdBy: 'Lulu', createdAt: Date.now() - 1000},
      {text: 'b', done: true, date: today, assignees: [], doneBy: 'Lulu', doneAt: Date.now() - 500, createdAt: 0},
      {text: 'c', done: false, date: today, assignees: ['lulu'], createdBy: 'Lulu', createdAt: Date.now() - 800},
    ];
    return composeDigest(items, 'Emile', Date.now() - 86400000, today);
  });
  console.log('digest:', JSON.stringify(digest.body));
  check('digest counts my open tasks (excl. delegated-away)', /^1 task open today/.test(digest.body));
  check('digest reports family adds and ticks', /1 new from the family/.test(digest.body) && /1 ticked off/.test(digest.body));

  const parsed = await page.evaluate(() => parseFsDoc({
    name: 'projects/p/databases/(default)/documents/households/h/items/t1',
    fields: {text: {stringValue: 'x'}, done: {booleanValue: true}, updated: {integerValue: '123'},
             assignees: {arrayValue: {values: [{stringValue: 'lulu'}]}}}
  }));
  check('Firestore REST doc parses', parsed.id === 't1' && parsed.done === true && parsed.updated === 123 && parsed.assignees[0] === 'lulu');

  // 4. digest settings UX without sync configured
  await page.click('nav.tabs button[data-view="settings"]');
  await page.click('#digestBtn');
  const ds = await page.locator('#digestStatus').textContent();
  check('digest requires a space first', /space first/.test(ds));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
