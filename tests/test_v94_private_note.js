// v94: the private space has a journal too — "Save to my Journal" from the
// capture screen keeps a note (text and/or photo) on-device with no task
// extraction and no space record. Viewers of read-only circles get the same
// private home for their words.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' — ' + (extra || ''))); cond ? pass++ : fail++; };
  const errors = [];
  const mk = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/googleapis|firebaseio|cloudfunctions|gstatic|firebaseapp/, r => r.abort());
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(init || (() => localStorage.setItem('onboarded', 'true')));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  };

  // ---------- 1. a solo user (no spaces at all) can journal ----------
  const A = await mk();
  await A.click('nav.tabs button[data-view="capture"]');
  check('solo user sees "Save to my Journal"',
    /my Journal/.test(await A.locator('#saveNoteBtn').textContent()) &&
    await A.locator('#saveNoteBtn').isVisible());
  await A.fill('#liveText', 'Slept badly but the morning walk helped, mood better by ten');
  await A.click('#saveNoteBtn');
  await A.waitForTimeout(400);
  const solo = await A.evaluate(() => ({
    idea: JSON.parse(localStorage.getItem('ideas') || '[]')[0],
    events: JSON.parse(localStorage.getItem('events') || '[]').length,
    todos: JSON.parse(localStorage.getItem('todos') || '[]').length,
    box: document.getElementById('liveText').value,
  }));
  check('the note lands in the Journal as a private note',
    solo.idea && /morning walk/.test(solo.idea.raw) && solo.idea.engine === 'note' && !solo.idea.sharedTo,
    JSON.stringify(solo.idea && {engine: solo.idea.engine, sharedTo: solo.idea.sharedTo}));
  check('no task extraction, no space record', solo.todos === 0 && solo.events === 0,
    JSON.stringify({todos: solo.todos, events: solo.events}));
  check('the capture box clears for the next thought', solo.box === '');
  await A.click('nav.tabs button[data-view="ideas"]');
  await A.waitForTimeout(300);
  check('the Notes section shows it', /morning walk/.test(await A.locator('#ideasList').textContent()));

  // ---------- 2. with spaces, the Private chip flips the button ----------
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Tahlia'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-mum', name: 'Mum', type: 'care', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-mum'));
  });
  await B.click('nav.tabs button[data-view="capture"]');
  check('space destination names the space journal',
    /Mum journal/.test(await B.locator('#saveNoteBtn').textContent()));
  await B.locator('#destChips .fchip', { hasText: 'Private' }).click();
  await B.waitForTimeout(150);
  check('Private chip → "Save to my Journal"',
    /my Journal/.test(await B.locator('#saveNoteBtn').textContent()));
  await B.fill('#liveText', 'Worried about the Chem exam, not for the family record');
  await B.click('#saveNoteBtn');
  await B.waitForTimeout(400);
  const priv = await B.evaluate(() => ({
    idea: JSON.parse(localStorage.getItem('ideas') || '[]')[0],
    noteEvents: JSON.parse(localStorage.getItem('events') || '[]').filter(e => e.kind === 'note').length,
  }));
  check('the private note never touches the space record',
    priv.idea && /Chem exam/.test(priv.idea.raw) && !priv.idea.sharedTo && priv.noteEvents === 0,
    JSON.stringify(priv));
  // and it can still be shared LATER from the Notes card if she chooses
  await B.click('nav.tabs button[data-view="ideas"]');
  await B.waitForTimeout(300);
  check('the private note still offers share-later chips',
    await B.locator('#ideasList .card', { hasText: 'Chem exam' }).locator('.share-note', { hasText: 'Share to Mum' }).count() === 1);

  // ---------- 3. a circle viewer's words get a private home ----------
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Vera'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-mia', name: "Mia's circle", type: 'circle', role: 'viewer', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-mia'));
  });
  await C.click('nav.tabs button[data-view="capture"]');
  check('viewer: the note button is the PRIVATE variant, not the circle',
    /my Journal/.test(await C.locator('#saveNoteBtn').textContent()));
  await C.fill('#liveText', 'Mia sounded so bright on the phone tonight');
  await C.click('#saveNoteBtn');
  await C.waitForTimeout(400);
  const vera = await C.evaluate(() => ({
    idea: JSON.parse(localStorage.getItem('ideas') || '[]')[0],
    events: JSON.parse(localStorage.getItem('events') || '[]').length,
  }));
  check('viewer note saves privately — zero phantom share',
    vera.idea && /bright on the phone/.test(vera.idea.raw) && vera.events === 0, JSON.stringify(vera));

  // ---------- 4. photo + private note ----------
  await A.click('nav.tabs button[data-view="capture"]');
  await A.evaluate(() => { capturePhoto = 'data:image/jpeg;base64,QUFB'; renderPhotoStrip(); });
  await A.fill('#liveText', 'The sunset from the balcony');
  await A.click('#saveNoteBtn');
  await A.waitForTimeout(400);
  const withPhoto = await A.evaluate(() => JSON.parse(localStorage.getItem('ideas') || '[]')[0]);
  check('a photo rides the private note too',
    withPhoto && /sunset/.test(withPhoto.raw) && !!withPhoto.photo && !withPhoto.sharedTo,
    JSON.stringify(withPhoto && {photo: !!withPhoto.photo}));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
