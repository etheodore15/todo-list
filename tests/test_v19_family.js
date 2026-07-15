const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c?'PASS':'FAIL')+': '+n); c?pass++:fail++; };
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });

  // 1. save household members
  await page.click('nav.tabs button[data-view="settings"]');
  await page.fill('#membersInput', 'Emile, Lulu');
  await page.click('#saveMembersBtn');
  const ms = await page.locator('#membersStatus').textContent();
  check('members saved', /emile, lulu/.test(ms));

  // 2. member auto-tagging (heuristic path)
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', "I need to remind Lulu to return the library books and I should book the car in for a service");
  await page.click('#saveIdeaBtn');
  await page.waitForTimeout(500);
  const lRow = page.locator('.todo', { hasText: 'library books' });
  const lTags = await lRow.locator('.ttag').allTextContents();
  check('lulu tag auto-applied', lTags.includes('lulu'));
  const chips = await page.locator('#tagFilter .fchip').allTextContents();
  check('person filter chip appears', chips.some(c => /^lulu/.test(c)));

  // 3. member names reach the AI prompt
  const prompt = await page.evaluate(() => buildIdeaPrompt('test'));
  check('prompt includes household members', /Household members: emile, lulu/.test(prompt));

  // 4. share (headless: falls back to clipboard) — navigate to Today first (v63)
  await page.click('nav.tabs button[data-view="today"]');
  await page.waitForTimeout(200);
  await page.locator('#tagFilter .fchip', { hasText: 'lulu' }).click();
  await page.click('#shareBtn');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  console.log('shared text:', JSON.stringify(clip.slice(0, 90)));
  check('share respects person filter', /Lulu list/.test(clip) && /library books/.test(clip) && !/car in for a service/.test(clip));

  // 5. export → download with data
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('nav.tabs button[data-view="settings"]').then(() => page.click('#exportBtn'))]);
  const path = await dl.path();
  const backup = JSON.parse(require('fs').readFileSync(path, 'utf8'));
  check('export contains tasks and members', backup.todos.length === 2 && backup.members.includes('lulu'));

  // 6. import replaces data
  backup.todos = [{id:'x1', text:'Imported task', priority:'medium', tags:['general'], done:false, date: new Date().toISOString().slice(0,10), ideaId:null}];
  backup.ideas = [];
  const tmp = '/tmp/claude-0/-home-user-Market-Research/ffc63541-1c42-508e-9f25-b6e37dea99e5/scratchpad/backup-mod.json';
  require('fs').writeFileSync(tmp, JSON.stringify(backup));
  page.once('dialog', d => d.accept());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#importBtn')]);
  await chooser.setFiles(tmp);
  await page.waitForTimeout(400);
  await page.click('nav.tabs button[data-view="today"]');
  const texts = await page.locator('.todo .ttext').allTextContents();
  check('import replaced tasks', texts.length === 1 && texts[0] === 'Imported task');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
