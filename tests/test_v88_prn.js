// v88: PRN interval line (persona study #3 — the palliative double-dose near
// miss). A journal note mentioning PRN becomes the "last dose" marker; Today
// shows when it was recorded, and — once a carer enters the prescriber's
// minimum gap — when that gap ends. The gap is shared space-wide and the
// change itself is an append-only record entry.
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
    await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    await p.click('nav.tabs button[data-view="today"]').catch(() => {});
    await p.waitForTimeout(200);
    return p;
  };

  // ---------- 1. recent PRN note, no gap set ----------
  const A = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Ines'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-mamma', name: 'Mamma', type: 'care', cfg: null}]));
    localStorage.setItem('events', JSON.stringify([
      {id: 'n1', ts: Date.now() - 100 * 60000, kind: 'note', who: 'Ines', space: 'hh-mamma',
       taskId: 'note-i1', text: 'PRN morphine 2.5mg given for breakthrough pain, settled after'}]));
  });
  check('banner appears after a PRN note', await A.locator('#prnBanner').isVisible());
  let txt = await A.locator('#prnBanner').textContent();
  check('names the space and the dose', /Mamma/.test(txt) && /PRN recorded/.test(txt), txt);
  check('says how long ago', /1 h 40 min ago/.test(txt), txt);
  check('offers to set the minimum gap', /Set minimum gap/.test(txt), txt);

  // set the gap through the real dialog
  await A.locator('#prnBanner .custody-set').click();
  await A.waitForTimeout(150);
  check('gap dialog explains it is the prescriber’s number, not advice',
    /prescriber/.test(await A.locator('#inputHint').textContent()));
  await A.fill('#inputField', '4');
  await A.click('#inputSave');
  await A.waitForTimeout(200);
  txt = await A.locator('#prnBanner').textContent();
  check('with a 4 h gap the banner shows when it ends', /4 h minimum gap you set ends at/.test(txt), txt);
  const evs = await A.evaluate(() => JSON.parse(localStorage.getItem('events') || '[]'));
  check('the gap change is an append-only record entry',
    evs.some(e => e.kind === 'prn-gap' && e.space === 'hh-mamma' && /4 h/.test(e.text)));
  const gapStored = await A.evaluate(() => JSON.parse(localStorage.getItem('prnGap') || '{}'));
  check('gap stored per space', gapStored['hh-mamma'] === 4, JSON.stringify(gapStored));

  // clear-of-gap branch: shrink the gap below the elapsed time
  await A.evaluate(() => { setPrnGap('hh-mamma', 0.5); renderPrnBanner(); });
  txt = await A.locator('#prnBanner').textContent();
  check('past the gap it says clear, with the number', /clear of the 30 min gap/.test(txt), txt);

  // ---------- 2. a time spoken INSIDE the note beats the typing time ----------
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-c', name: 'Dad', type: 'care', cfg: null}]));
    const noon = new Date(); noon.setHours(14, 40, 0, 0);   // typed 2:40pm, given 2:15pm
    localStorage.setItem('events', JSON.stringify([
      {id: 'n2', ts: noon.getTime(), kind: 'note', who: 'Kim', space: 'hh-c',
       taskId: 'note-b1', text: 'PRN given at 2:15pm for pain'}]));
  });
  txt = await B.locator('#prnBanner').textContent();
  check('the in-note dose time wins over the typing time', /2:15/.test(txt) && !/2:40/.test(txt), txt);

  // ---------- 3. what must NOT trigger it ----------
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-c', name: 'Dad', type: 'care', cfg: null},
      {hid: 'hh-f', name: 'Home', type: 'family', cfg: null}]));
    localStorage.setItem('events', JSON.stringify([
      // plain care note, no PRN
      {id: 'x1', ts: Date.now() - 3600000, kind: 'note', who: 'A', space: 'hh-c', taskId: 'note-x1', text: 'Ate well at lunch'},
      // PRN in a FAMILY space (not a care record)
      {id: 'x2', ts: Date.now() - 3600000, kind: 'note', who: 'A', space: 'hh-f', taskId: 'note-x2', text: 'PRN painkiller taken'},
      // stale PRN, 25h old
      {id: 'x3', ts: Date.now() - 25 * 3600000, kind: 'note', who: 'A', space: 'hh-c', taskId: 'note-x3', text: 'PRN morphine given'},
      // recent PRN whose share was TAKEN BACK (v73 pairing)
      {id: 'x4', ts: Date.now() - 3600000, kind: 'note', who: 'A', space: 'hh-c', taskId: 'note-x4', text: 'PRN morphine given'},
      {id: 'x5', ts: Date.now() - 1800000, kind: 'note-removed', who: 'A', space: 'hh-c', taskId: 'note-x4', text: 'PRN morphine given'}]));
  });
  check('no banner for plain notes, family-space PRN, stale or retracted doses',
    !(await C.locator('#prnBanner').isVisible()), await C.locator('#prnBanner').textContent());

  // ---------- 4. a NEWER PRN note moves the marker ----------
  const D = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-c', name: 'Mamma', type: 'care', cfg: null}]));
    localStorage.setItem('prnGap', JSON.stringify({'hh-c': 4}));
    localStorage.setItem('events', JSON.stringify([
      {id: 'd1', ts: Date.now() - 6 * 3600000, kind: 'note', who: 'Rosa', space: 'hh-c', taskId: 'note-d1', text: 'PRN morphine 2.5mg given, settled'},
      {id: 'd2', ts: Date.now() - 30 * 60000, kind: 'note', who: 'Marco', space: 'hh-c', taskId: 'note-d2', text: 'another PRN dose given, pain 7'}]));
  });
  txt = await D.locator('#prnBanner').textContent();
  check('latest dose drives the countdown (30 min ago, not 6 h)',
    /Marco/.test(txt) && /gap you set ends at/.test(txt), txt);

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
