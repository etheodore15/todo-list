// v36: per-space members, alternating-week custody, managed-mode digest snapshot.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    localStorage.setItem('myName', JSON.stringify('alex'));
    localStorage.setItem('members', JSON.stringify(['alex', 'jo']));   // global list
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cop', name: 'Co-parenting', type: 'coparenting', cfg: {apiKey:'k', projectId:'p'}}]));
  });
  await page.addInitScript(() => { try { localStorage.setItem("onboarded", "true"); } catch(e){} });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // ---------- Gap 1: per-space members override the global list ----------
  let members = await page.evaluate(() => {
    setSpaceMembers('hh-cop', ['alex', 'sam']);
    return {space: spaceMembers('hh-cop'), other: spaceMembers('hh-none')};
  });
  check('Gap1: space members used when set', JSON.stringify(members.space) === '["alex","sam"]');
  check('Gap1: falls back to global list when unset', JSON.stringify(members.other) === '["alex","jo"]');

  // scope sheet on a task in that space offers the space's members (sam), not global (jo)
  await page.evaluate(() => {
    todos.push({id:'t1', text:'swap pickup', priority:'medium', tags:['general'], done:false,
      date: todayStr(), space:'hh-cop', createdBy:'alex', createdAt: Date.now()});
    saveTodos();
  });
  await page.click('nav.tabs button[data-view="today"]');
  await page.locator('.todo', { hasText: 'swap pickup' }).locator('.scope-chip').click();
  await page.waitForTimeout(200);
  const scopeNames = await page.locator('#scopeMembers label').allTextContents();
  check('Gap1: scope sheet shows space members',
    scopeNames.some(t => /sam/.test(t)) && !scopeNames.some(t => /jo/.test(t)));
  await page.click('#scopeCancel');

  // ---------- Gap 2: alternating-week custody ----------
  const alt = await page.evaluate(() => {
    // alex has the kids on a fixed weekday; alternate weeks flip it.
    const anchorSun = (() => { const n = new Date();
      return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - n.getUTCDay())).toISOString().slice(0,10); })();
    const wd = new Date().getUTCDay();
    setLocalCustody('hh-cop', {days:[wd], by:'alex', other:'sam', alternate:true, anchor:anchorSun});
    const thisWeek = custodyOn('hh-cop', todayStr());
    const nextWeekSameDay = custodyOn('hh-cop', new Date(Date.now()+7*86400000).toISOString().slice(0,10));
    return {thisWeek, nextWeekSameDay};
  });
  check('Gap2: alternate — my day this week', alt.thisWeek === 'me');
  check('Gap2: alternate — flips to their day next week', alt.nextWeekSameDay === 'them');

  // non-alternating stays put next week
  const fixed = await page.evaluate(() => {
    const wd = new Date().getUTCDay();
    setLocalCustody('hh-cop', {days:[wd], by:'alex', other:'sam', alternate:false});
    return {a: custodyOn('hh-cop', todayStr()),
            b: custodyOn('hh-cop', new Date(Date.now()+7*86400000).toISOString().slice(0,10))};
  });
  check('Gap2: non-alternating is the same next week', fixed.a === 'me' && fixed.b === 'me');

  // the alternate checkbox is in the custody sheet and persists
  await page.click('nav.tabs button[data-view="settings"]');
  await page.locator('#spacesList button', { hasText: 'Custody days' }).click();
  check('Gap2: custody sheet has an alternate toggle',
    await page.locator('#custodyAlt').count() === 1 && !(await page.locator('#custodyAlt').isChecked()));
  await page.click('#custodyCancel');

  // ---------- Gap 3: managed digest works from the snapshot (no key/proxy) ----------
  await page.addScriptTag({ url: 'http://localhost:8906/digest.js' });
  const dig = await page.evaluate((today) => {
    const tomo = new Date(new Date(today+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10);
    // snapshot the page would send the SW — pure objects, no Firestore
    const snapshot = [
      {text:'A', done:false, date: today, assignees:[], createdBy:'alex', createdAt:0, doneBy:null, doneAt:0},
      {text:'B', done:false, date: tomo,  assignees:[], createdBy:'alex', createdAt:0, doneBy:null, doneAt:0},
      {text:'C', done:true,  date: today, assignees:[], createdBy:'sam', createdAt:0, doneBy:'sam', doneAt: Date.now()}
    ];
    return composeDigest(snapshot, 'alex', 0, today);
  }, new Date().toISOString().slice(0,10));
  check('Gap3: digest composes from snapshot — open today', dig.openToday === 1);
  check('Gap3: digest counts due tomorrow', dig.dueTomorrow === 1);
  check('Gap3: digest counts a teammate tick', dig.ticks.length === 1);
  check('Gap3: digest body reads correctly',
    /1 task open today · 1 due tomorrow · 1 ticked off/.test(dig.body));

  // updateSwConfig posts managed + snapshot when a managed space exists
  const posted = await page.evaluate(async () => {
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-m', name:'Home', type:'family', managed:true, cfg:null}]));
    let captured = null;
    // stub the SW messaging
    const fakeReg = {active: {postMessage: (m) => { captured = m; }}};
    Object.defineProperty(navigator, 'serviceWorker', {configurable:true, get:()=>({ready: Promise.resolve(fakeReg)})});
    todos.length = 0;
    todos.push({id:'x', text:'shared task', priority:'low', tags:['general'], done:false, date: todayStr(), space:'hh-m', createdBy:'alex', createdAt:Date.now()});
    await updateSwConfig();
    return captured && captured.cfg;
  });
  check('Gap3: SW config includes managed flag + snapshot',
    posted && posted.managed === true && Array.isArray(posted.snapshot) && posted.snapshot.some(t => /shared task/.test(t.text)));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
