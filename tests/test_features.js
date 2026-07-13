const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  let pass = 0, fail = 0;
  const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name); cond ? pass++ : fail++; };

  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });

  await page.goto('http://localhost:8904/', { waitUntil: 'networkidle' });

  // --- priority scoring ---
  const prios = await page.evaluate(() => [
    detectPriority("I urgently need to call the accountant today about the tax deadline"),
    detectPriority("book the dentist this week"),
    detectPriority("maybe someday look into a new laptop"),
    detectPriority("I should pay the electricity bill, it's overdue and really important"),
    detectPriority("buy milk"),
    detectPriority("no rush but eventually clean the garage"),
  ]);
  check('urgent+today = high', prios[0] === 'high');
  check('this week = medium', prios[1] === 'medium');
  check('maybe someday = low', prios[2] === 'low');
  check('overdue+important = high', prios[3] === 'high');
  check('plain task = medium', prios[4] === 'medium');
  check('no rush+eventually = low', prios[5] === 'low');

  // --- capture with fillers ---
  await page.fill('#liveText', "okay so um I really need to send the invoice to David today it's urgent, and I was thinking about maybe someday redesigning the website");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const taskTexts = await page.locator('.todo .txt').allTextContents();
  check('fillers stripped (no "okay so um")', taskTexts.every(t => !/okay|um\b|so\b/i.test(t.split(' ').slice(0,2).join(' '))));
  const sections = await page.locator('.prio-section h2').allTextContents();
  check('urgent task in Do first', sections.some(s => /Do first/.test(s)));
  check('someday task in If time allows', sections.some(s => /If time allows/.test(s)));

  // --- dedupe: re-capture the same idea ---
  const before = await page.locator('.todo').count();
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', "I need to send the invoice to David today it's urgent");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const after = await page.locator('.todo').count();
  check('duplicate task not re-added', after === before);

  // --- linking: todo -> idea ---
  const linkBtns = await page.locator('.todo .link-btn').count();
  check('todos show idea link button', linkBtns > 0);
  await page.locator('.todo .link-btn').first().click();
  await page.waitForTimeout(400);
  const ideasVisible = await page.locator('#view-ideas.active').count();
  check('link button opens Ideas view', ideasVisible === 1);
  const flashed = await page.locator('.card.flash').count();
  check('source idea highlighted', flashed === 1);

  // --- linking: idea card shows tasks with checkboxes ---
  const miniTasks = await page.locator('.card .mini-task').count();
  check('idea card lists its tasks', miniTasks > 0);
  await page.locator('.card .mini-task .mchk').first().click();
  await page.waitForTimeout(200);
  check('mini checkbox marks done', await page.locator('.card .mini-task.done').count() === 1);
  // and it syncs to Today
  await page.click('nav.tabs button[data-view="today"]');
  check('done state synced to Today', await page.locator('.todo.done').count() >= 1);

  await page.screenshot({ path: '/tmp/claude-0/-home-user-Market-Research/ffc63541-1c42-508e-9f25-b6e37dea99e5/scratchpad/v4_ideas.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail || errors.length ? 1 : 0);
})();
