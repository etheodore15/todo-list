// v25 ADHD pack part 1: Break it down (B1) + Just One Thing focus mode (B2).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();

  // mock Gemini: model discovery + breakdown call
  let breakdownPrompt = '';
  await ctx.route('**/generativelanguage.googleapis.com/**', async route => {
    if (route.request().method() === 'GET'){
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({models: [{name: 'models/gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent']}]}) });
      return;
    }
    const body = JSON.parse(route.request().postData());
    breakdownPrompt = body.contents[0].parts[0].text;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({
        steps: ['Put 5 things in the dishwasher', 'Clear the left bench', 'Wipe the stovetop']
      })}]}}]}) });
  });

  const page = await ctx.newPage();
  const today = new Date().toISOString().slice(0, 10);
  await page.addInitScript((d) => {
    if (localStorage.getItem('todos')) return;
    localStorage.setItem('geminiKey', JSON.stringify('AIza-test'));
    localStorage.setItem('todos', JSON.stringify([
      {id:'k1', text:'Clean the kitchen', priority:'medium', tags:['home'], done:false, date:d, ideaId:null},
      {id:'k2', text:'Call the bank about the card', priority:'high', tags:['calls','finance'], done:false, date:d, ideaId:null},
      {id:'k3', text:'Water the plants', priority:'low', tags:['home'], done:false, date:d, ideaId:null},
    ]));
  }, today);

  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
  await page.click('nav.tabs button[data-view="today"]');

  // ---------- B1: break it down via Gemini ----------
  const kitchen = page.locator('.todo', { hasText: 'Clean the kitchen' });
  await kitchen.locator('.ttext').click();
  check('B1: detail panel has Break down', await kitchen.locator('.tact', { hasText: 'Break down' }).count() === 1);
  await kitchen.locator('.tact', { hasText: 'Break down' }).click();
  await page.waitForTimeout(400);
  check('B1: breakdown prompt sent with task text', /Clean the kitchen/.test(breakdownPrompt));
  check('B1: tiny-first-step rule in prompt', /under two minutes/.test(breakdownPrompt));
  const steps = await page.locator('.todo', { hasText: 'Clean the kitchen' }).locator('.subtasks .mtxt').allTextContents();
  check('B1: 3 subtasks rendered', steps.length === 3 && /dishwasher/.test(steps[0]));

  // tick all steps (always the first still-open one) → parent auto-done
  for (let i = 0; i < 3; i++){
    await page.locator('.todo', { hasText: 'Clean the kitchen' })
      .locator('.subtasks .mini-task:not(.done) .mchk').first().click();
    await page.waitForTimeout(120);
  }
  check('B1: all steps done ticks the parent',
    await page.locator('.todo.done', { hasText: 'Clean the kitchen' }).count() === 1);
  check('B1: auto-tick offers undo', await page.locator('#toast.show .undo').count() === 1);
  check('B1: subtasks persist',
    await page.evaluate(() => JSON.parse(localStorage.getItem('todos'))
      .find(t => t.id === 'k1').subtasks.every(s => s.done)));

  // ---------- B1: offline fallback splits compound tasks ----------
  const fb = await page.evaluate(() => localBreakdown('empty the bins, water the garden and sweep the deck'));
  check('B1: built-in fallback splits compound task', fb && fb.length === 3 && /sweep/i.test(fb[2]));
  const fb2 = await page.evaluate(() => localBreakdown('clean the kitchen'));
  check('B1: built-in fallback declines simple task', fb2 === null);

  // ---------- B2: Just One Thing ----------
  check('B2: focus button visible', await page.locator('#focusBtn').isVisible());
  await page.click('#focusBtn');
  check('B2: overlay opens', await page.locator('#focusOverlay').isVisible());
  const first = await page.locator('#focusTask').textContent();
  check('B2: highest-priority task shown first', /Call the bank/.test(first));

  await page.click('#focusSkip');
  const second = await page.locator('#focusTask').textContent();
  check('B2: "not this one" shows a different task', second !== first);

  await page.click('#focusDone');
  await page.waitForTimeout(150);
  const third = await page.locator('#focusTask').textContent();
  check('B2: done advances to the next task', third !== second && !/last one/.test(third));
  check('B2: ticked task recorded',
    await page.evaluate((t) => JSON.parse(localStorage.getItem('todos'))
      .some(td => td.text === t && td.done), second));

  await page.click('#focusDone');
  await page.waitForTimeout(200);
  check('B2: finishing the last shows celebration',
    /last one/.test(await page.locator('#focusTask').textContent()));
  await page.waitForTimeout(1600);
  check('B2: overlay closes after celebration', !(await page.locator('#focusOverlay').isVisible()));
  check('B2: focus button hides when nothing open', !(await page.locator('#focusBtn').isVisible()));

  // ---------- B2: broken-down task surfaces its next step ----------
  await page.evaluate((d) => {
    todos.push({id: 'k4', text: 'Sort the paperwork', priority: 'medium', tags: ['admin'], done: false,
      date: d, subtasks: [{text: 'Find the blue folder', done: false}, {text: 'File the bills', done: false}]});
    saveTodos(); renderTodos();
  }, today);
  await page.click('#focusBtn');
  check('B2: next tiny step surfaced in focus',
    /Start here: Find the blue folder/.test(await page.locator('#focusSteps').textContent()));
  await page.locator('#focusSteps .mchk').click();
  await page.waitForTimeout(120);
  check('B2: ticking the step advances to the next step',
    /Start here: File the bills/.test(await page.locator('#focusSteps').textContent()));
  await page.locator('#focusSteps .mchk').click();
  await page.waitForTimeout(200);
  check('B2: last step ticks the whole task',
    await page.evaluate(() => JSON.parse(localStorage.getItem('todos'))
      .find(t => t.id === 'k4').done));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
