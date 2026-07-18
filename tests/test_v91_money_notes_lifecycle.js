// v91: spoken amounts → ledger (#7), honest note cap (#4), space lifecycle (#14).
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
  const settle = (p) => p.waitForFunction(() => !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, { timeout: 20000 });

  // ================= #7: spoken amounts become expenses =================
  const A = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Beth'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-pip', name: 'Pip', type: 'coparenting', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-pip'));
  });
  const amounts = await A.evaluate(() => [
    parseAmount('Pay the school photo money $38 by Friday'),
    parseAmount('I paid $180 for the carpet cleaner everyone owes me $36'),
    parseAmount('invoice the Hendersons $480'),
    parseAmount('costs about 45 dollars a week'),
    parseAmount('put 40 bucks of fuel in the mower'),
    parseAmount('call the accountant about the report'),
  ]);
  check('#7 "$38 by Friday" → 38', amounts[0] === 38, String(amounts[0]));
  check('#7 first amount wins ($180 paid, not the $36 owed)', amounts[1] === 180, String(amounts[1]));
  check('#7 "$480" invoice parses', amounts[2] === 480);
  check('#7 "45 dollars" / "40 bucks" parse', amounts[3] === 45 && amounts[4] === 40);
  check('#7 no phantom amounts without money talk', amounts[5] === null);

  // full pipeline: Beth's exact capture — the duplicate-payment problem
  await A.click('nav.tabs button[data-view="capture"]');
  await A.fill('#liveText', 'Pay the school photo money $38 by Friday');
  await A.click('#saveIdeaBtn');
  await settle(A);
  const photo = await A.evaluate(() => JSON.parse(localStorage.getItem('todos') || '[]').find(t => /photo/i.test(t.text)));
  check('#7 the captured task carries the expense', photo && photo.amount === 38 && photo.expenseBy === 'Beth',
    JSON.stringify(photo && {amount: photo.amount, by: photo.expenseBy}));
  check('#7 …aimed at the space, receipt queued for the shared ledger', photo && photo.space === 'hh-pip');
  await A.evaluate(() => openLedger(spacesList()[0]));
  await A.waitForTimeout(400);
  check('#7 the ledger shows it without any re-typing',
    /38\.00/.test(await A.locator('#ledgerTotals').textContent()) || /38\.00/.test(await A.locator('#ledgerList').textContent()));

  // ================= #4: the note cap is generous and honest =================
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Carla'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-dad', name: 'Dad', type: 'care', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-dad'));
  });
  const gpNote = 'GP review notes: the donepezil is holding, MMSE stable at 24, discussed driving and agreed to an OT assessment before renewal, bloods fine except vitamin D so starting a supplement, next review in twelve weeks, she gave us the My Aged Care number to start a home support assessment before we actually need it because the waitlists are long, also flagged that if wandering starts we should look at a mattress sensor before considering anything more restrictive, and to watch evening confusion after his afternoon nap which matches what Sean noticed, and she printed the updated medication list which I have put on the fridge next to the calendar so everyone sees it at every handover on Saturday';
  await B.click('nav.tabs button[data-view="capture"]');
  await B.fill('#liveText', gpNote);
  await B.click('#saveNoteBtn');
  await B.waitForTimeout(400);
  const ev = await B.evaluate(() => JSON.parse(localStorage.getItem('events') || '[]').find(e => e.kind === 'note' && /MMSE/i.test(e.text)));
  check('#4 the 700-char GP note is shared WHOLE (was cut at 600)',
    ev && /Saturday/.test(ev.text) && ev.text.length > 600, ev && String(ev.text.length));
  const long = await B.evaluate(() => { const t = 'word '.repeat(500); return noteShareText(t).length; });
  check('#4 a 2500-char monster still caps at 2000 (with a toast, not silence)', long === 2000, String(long));
  check('#4 …and the toast says so', await B.evaluate(() => document.body.textContent.includes('Long note')));

  // ================= #14: archive / reopen / export-and-remove =================
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Pat'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-rehab', name: 'Mick rehab', type: 'care', cfg: null},
      {hid: 'hh-home', name: 'Home', type: 'family', cfg: null}]));
    const t = new Date().toISOString().slice(0, 10);
    localStorage.setItem('todos', JSON.stringify([
      {id: 'r1', text: 'Physio exercises', priority: 'medium', tags: [], done: false, date: t, space: 'hh-rehab', recur: {type: 'daily'}},
      {id: 'h1', text: 'Mow the lawn', priority: 'low', tags: [], done: false, date: t, space: 'hh-home'}]));
    localStorage.setItem('events', JSON.stringify([
      {id: 'e1', ts: Date.now() - 86400000, kind: 'note', who: 'Pat', space: 'hh-rehab', taskId: 'note-1', text: 'Mick teary after speech session'}]));
  });
  C.on('dialog', d => d.accept());
  await C.evaluate(() => { window.confirm = () => true; archiveSpace(spacesAll().find(s => s.hid === 'hh-rehab')); });
  await C.waitForTimeout(300);
  const st = await C.evaluate(() => ({
    archivedFlag: spacesAll().find(s => s.hid === 'hh-rehab').archived,
    inDaily: spacesList().some(s => s.hid === 'hh-rehab'),
    archEvent: JSON.parse(localStorage.getItem('events') || '[]').some(e => e.kind === 'archived' && e.space === 'hh-rehab'),
  }));
  check('#14 archive flags the space and logs the closure in the record',
    st.archivedFlag === true && st.archEvent, JSON.stringify(st));
  check('#14 archived space leaves the daily space list', st.inDaily === false);
  await C.click('nav.tabs button[data-view="today"]');
  await C.waitForTimeout(300);
  const todayTxt = await C.locator('#view-today').textContent();
  check('#14 its tasks rest with it (physio gone, lawn stays)',
    !/Physio exercises/.test(todayTxt) && /Mow the lawn/.test(todayTxt));
  await C.click('nav.tabs button[data-view="capture"]');
  check('#14 not offered as a capture destination',
    await C.locator('#destChips .fchip', { hasText: 'Mick rehab' }).count() === 0);
  await C.click('nav.tabs button[data-view="ideas"]');
  await C.waitForTimeout(300);
  check('#14 no report card for a closed season',
    await C.locator('.rep-card', { hasText: 'Doctor briefing' }).count() === 0);
  // Settings: read-only row with History, Reopen, Export & remove
  await C.click('nav.tabs button[data-view="settings"]');
  await C.waitForTimeout(300);
  const row = C.locator('.space-row', { hasText: 'Mick rehab (archived)' });
  check('#14 Settings shows the archived row', await row.count() === 1);
  check('#14 …with History, Reopen and Export & remove',
    await row.locator('.btn', { hasText: 'History' }).count() === 1 &&
    await row.locator('.btn', { hasText: 'Reopen' }).count() === 1 &&
    await row.locator('.btn', { hasText: 'Export & remove' }).count() === 1);
  // reopen restores everything
  await row.locator('.btn', { hasText: 'Reopen' }).click();
  await C.waitForTimeout(300);
  const back = await C.evaluate(() => ({
    active: spacesList().some(s => s.hid === 'hh-rehab'),
    ev: JSON.parse(localStorage.getItem('events') || '[]').some(e => e.kind === 'unarchived'),
  }));
  check('#14 reopen restores the space and records that too', back.active && back.ev, JSON.stringify(back));

  // export-and-remove: the foster obligation (archive again first)
  await C.evaluate(() => { window.confirm = () => true; archiveSpace(spacesAll().find(s => s.hid === 'hh-rehab')); });
  await C.waitForTimeout(200);
  const dl = C.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await C.locator('.space-row', { hasText: 'Mick rehab (archived)' }).locator('.btn', { hasText: 'Export & remove' }).click();
  await C.waitForTimeout(200);
  await C.fill('#inputField', 'Mick rehab');
  await C.click('#inputSave');
  const download = await dl;
  await C.waitForTimeout(400);
  const gone = await C.evaluate(() => ({
    space: spacesAll().some(s => s.hid === 'hh-rehab'),
    tasks: JSON.parse(localStorage.getItem('todos') || '[]').some(t => t.space === 'hh-rehab'),
    events: JSON.parse(localStorage.getItem('events') || '[]').some(e => e.space === 'hh-rehab'),
    otherTasks: JSON.parse(localStorage.getItem('todos') || '[]').some(t => t.space === 'hh-home'),
  }));
  check('#14 the record leaves as a CSV before anything is removed',
    !!download && /record\.csv$/.test(download.suggestedFilename()), download && download.suggestedFilename());
  check('#14 export & remove purges space, tasks and local record',
    !gone.space && !gone.tasks && !gone.events, JSON.stringify(gone));
  check('#14 …touching nothing else', gone.otherTasks === true);
  // the wrong confirmation name removes nothing
  const D = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-x', name: 'Placement', type: 'care', cfg: null, archived: true}]));
  });
  await D.click('nav.tabs button[data-view="settings"]');
  await D.waitForTimeout(300);
  await D.locator('.space-row', { hasText: 'Placement (archived)' }).locator('.btn', { hasText: 'Export & remove' }).click();
  await D.fill('#inputField', 'wrong name');
  await D.click('#inputSave');
  await D.waitForTimeout(300);
  check('#14 a mistyped name removes nothing', await D.evaluate(() => spacesAll().length === 1));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
