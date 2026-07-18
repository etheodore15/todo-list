// v85: notes reach the space they were aimed at, and reports show them.
//  A. Summarize & Add with a space destination and no extractable tasks
//     auto-saves the note to that space's journal (event + sharedTo).
//  A2. The "Save to <space> journal" button is offered for family spaces
//     (was care/circle-only).
//  B. The Notes list offers share/redirect buttons for every space type.
//  C. The family week report and co-parenting records summary include notes.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = 0, fail = 0;
  const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name); cond ? pass++ : fail++; };

  await page.addInitScript(() => {
    try {
      localStorage.setItem('onboarded', 'true');
      localStorage.setItem('myName', JSON.stringify('Emile'));
      // two local (unsynced) spaces — allocation logic is all client-side
      localStorage.setItem('spaces', JSON.stringify([
        {hid: 'hh-fam-test', name: 'new household', type: 'family', cfg: null},
        {hid: 'hh-co-test', name: 'co', type: 'coparenting', cfg: null}
      ]));
    } catch (e) {}
  });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });

  // ---------- A2: journal-save button offered for a family space ----------
  await page.click('nav.tabs button[data-view="capture"]');
  await page.click('#destChips .fchip:has-text("new household")');
  const noteBtnVisible = await page.locator('#saveNoteBtn').isVisible();
  check('family space offers "Save to journal" button', noteBtnVisible);
  const noteBtnLabel = await page.locator('#saveNoteBtn').textContent();
  check('journal button names the space', /new household journal/.test(noteBtnLabel));

  // ---------- A: taskless capture aimed at a space lands in its journal ----------
  await page.fill('#liveText', "I'm testing the voice transcription process on this app");
  await page.click('#saveIdeaBtn');
  // structuring tries the AI proxy first and falls back to the local engine —
  // wait for the pending flag to clear rather than guessing a delay
  await page.waitForFunction(() =>
    !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, {timeout: 30000});
  const shared = await page.evaluate(() => {
    const ideas = JSON.parse(localStorage.getItem('ideas') || '[]');
    return ideas.length && (ideas[0].sharedTo || []).includes('hh-fam-test');
  });
  check('taskless capture auto-shared to the destination journal', shared);
  const noteEv = await page.evaluate(() => {
    const evs = JSON.parse(localStorage.getItem('events') || '[]');
    return evs.some(e => e.kind === 'note' && e.space === 'hh-fam-test' && /voice transcription/.test(e.text));
  });
  check('note event appended to the space record', noteEv);

  // a capture WITH tasks still routes tasks (not the raw note) to the space
  await page.click('nav.tabs button[data-view="capture"]');
  await page.fill('#liveText', 'I need to book the car in for a service tomorrow');
  await page.click('#saveIdeaBtn');
  await page.waitForFunction(() =>
    !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, {timeout: 30000});
  const taskState = await page.evaluate(() => {
    const todos = JSON.parse(localStorage.getItem('todos') || '[]');
    const ideas = JSON.parse(localStorage.getItem('ideas') || '[]');
    const td = todos.find(t => /car/.test(t.text));
    const idea = ideas.find(i => /car/.test(i.raw));
    return {taskSpace: td && td.space, ideaShared: !!(idea && (idea.sharedTo || []).length)};
  });
  check('capture with tasks: task allocated to the space', taskState.taskSpace === 'hh-fam-test');
  check('capture with tasks: raw note stays private', !taskState.ideaShared);

  // ---------- B: share/redirect buttons for every space on the Notes list ----------
  await page.click('nav.tabs button[data-view="ideas"]');
  await page.waitForTimeout(300);
  const firstCard = page.locator('#ideasList .card').first();
  const famChip = await firstCard.locator('.share-note', { hasText: 'new household' }).count();
  const coChip = await firstCard.locator('.share-note', { hasText: 'co' }).count();
  check('note card shows a chip for the family space', famChip === 1);
  check('note card shows a chip for the co-parenting space', coChip === 1);

  // redirect: remove from family, share to co — the note becomes co's
  const autoCard = page.locator('#ideasList .card', { hasText: 'voice transcription' }).first();
  await autoCard.locator('.share-note', { hasText: 'remove' }).first().click();
  await page.waitForTimeout(200);
  await page.locator('#ideasList .card', { hasText: 'voice transcription' }).first()
    .locator('.share-note', { hasText: 'Share to co' }).first().click();
  await page.waitForTimeout(200);
  const redirected = await page.evaluate(() => {
    const ideas = JSON.parse(localStorage.getItem('ideas') || '[]');
    const idea = ideas.find(i => /voice transcription/.test(i.raw));
    const evs = JSON.parse(localStorage.getItem('events') || '[]');
    return {
      sharedTo: idea ? idea.sharedTo : null,
      removedEv: evs.some(e => e.kind === 'note-removed' && e.space === 'hh-fam-test'),
      coEv: evs.some(e => e.kind === 'note' && e.space === 'hh-co-test')
    };
  });
  check('redirect: removed from the family journal (record kept)', redirected.removedEv);
  check('redirect: note now shared to co only',
    JSON.stringify(redirected.sharedTo) === JSON.stringify(['hh-co-test']) && redirected.coEv);

  // ---------- C: reports include the notes ----------
  // family report must EXCLUDE the removed note; put a fresh note in first
  await page.click('nav.tabs button[data-view="capture"]');
  await page.click('#destChips .fchip:has-text("new household")');
  await page.fill('#liveText', 'Lulu seemed happier at pickup today');
  await page.click('#saveNoteBtn');
  await page.waitForTimeout(500);
  await page.click('nav.tabs button[data-view="ideas"]');
  await page.click('.rep-card:has-text("Week report")');
  await page.waitForTimeout(600);
  const rep = await page.locator('#briefBody').textContent();
  check('family report has a Notes this week section', /Notes this week/.test(rep));
  check('family report quotes the journal note', /happier at pickup/.test(rep));
  check('family report excludes the removed note', !/voice transcription/.test(rep));
  await page.click('#briefClose');

  // co-parenting records summary shows the redirected note
  await page.click('.rep-card:has-text("Records summary")');
  await page.waitForTimeout(600);
  const rep2 = await page.locator('#briefBody').textContent();
  check('co-parenting summary has Notes on the record', /Notes on the record/.test(rep2));
  check('co-parenting summary quotes the redirected note', /voice transcription/.test(rep2));

  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
