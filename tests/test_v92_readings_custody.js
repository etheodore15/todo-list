// v92: readings from notes (#15) + term/holiday custody with third caregivers (#13).
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

  // ================= #15: observations parse from prose =================
  const A = await mk();
  const obs = await A.evaluate(() => [
    parseObservation('BGL 4.2 before lunch, gave 15g carbs'),
    parseObservation('Sugar was 9.1 this morning after the birthday cake'),
    parseObservation('Sats 93 this morning, bit more puffed on the stairs'),
    parseObservation('80ml at 2am, went back down okay'),
    parseObservation('Flare day, joints bad, rating it a 7'),
    parseObservation('temp 38.2 tonight, gave paracetamol'),
    parseObservation('weighed in at 4.2kg at the clinic'),
    parseObservation('BP 130 over 85 at the pharmacy'),
    parseObservation('Ate well at lunch, good mood'),          // no number talk
    parseObservation('took the 3 bins out at 7 Elm St'),       // numbers but no metric
  ]);
  check('#15 BGL parses', obs[0] && obs[0].kind === 'bgl' && obs[0].value === 4.2, JSON.stringify(obs[0]));
  check('#15 "sugar was 9.1" parses as BGL', obs[1] && obs[1].kind === 'bgl' && obs[1].value === 9.1, JSON.stringify(obs[1]));
  check('#15 sats parse', obs[2] && obs[2].kind === 'sats' && obs[2].value === 93, JSON.stringify(obs[2]));
  check('#15 feed volumes parse', obs[3] && obs[3].kind === 'feed' && obs[3].value === 80, JSON.stringify(obs[3]));
  check('#15 "rating it a 7" parses', obs[4] && obs[4].kind === 'rating' && obs[4].value === 7, JSON.stringify(obs[4]));
  check('#15 temp and weight parse', obs[5] && obs[5].value === 38.2 && obs[6] && obs[6].value === 4.2,
    JSON.stringify([obs[5], obs[6]]));
  check('#15 BP parses as a pair', obs[7] && obs[7].value === '130/85', JSON.stringify(obs[7]));
  check('#15 plain prose stays prose (no phantom readings)', obs[8] === null && obs[9] === null,
    JSON.stringify([obs[8], obs[9]]));

  // the briefing turns the series into a trend — Omar's exact BGL week
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Omar'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-sami', name: 'Sami T1D', type: 'care', cfg: null}]));
    const now = Date.now(), H = 3600000;
    localStorage.setItem('events', JSON.stringify([
      {id: 'b1', ts: now - 50 * H, kind: 'note', who: 'Omar', space: 'hh-sami', taskId: 'n1', text: 'BGL 4.2 before lunch, gave 15g carbs'},
      {id: 'b2', ts: now - 30 * H, kind: 'note', who: 'Rania', space: 'hh-sami', taskId: 'n2', text: 'BGL 12.8 after birthday party, corrected as per plan'},
      {id: 'b3', ts: now - 5 * H, kind: 'note', who: 'Omar', space: 'hh-sami', taskId: 'n3', text: 'BGL 6.1 before dinner, steady'},
      {id: 'b4', ts: now - 4 * H, kind: 'note', who: 'Omar', space: 'hh-sami', taskId: 'n4', text: 'Slept well, no overnight alarms'}]));
  });
  await B.click('nav.tabs button[data-view="ideas"]');
  await B.waitForTimeout(300);
  await B.locator('.rep-card', { hasText: 'Doctor briefing' }).click();
  await B.waitForFunction(() => !/composing the brief|shared records…$/.test(document.getElementById('briefBody').textContent.trim()), null, {timeout: 15000});
  await B.waitForTimeout(200);
  const brief = await B.locator('#briefBody').textContent();
  check('#15 briefing gains a Readings section', /Readings — from the notes/.test(brief), brief.slice(0, 150));
  check('#15 …with the BGL series oldest → newest', /BGL \(mmol\/L\): 4\.2 → 12\.8 → 6\.1/.test(brief), brief);
  check('#15 …count and range stated', /3 readings · range 4\.2–12\.8/.test(brief), brief);
  check('#15 prose notes still appear as observations', /Slept well/.test(brief));

  // ================= #13: term/holiday custody + third caregivers =================
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Mel'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-huy', name: 'Huy', type: 'coparenting', cfg: null}]));
    localStorage.setItem('spaceMembers', JSON.stringify({'hh-huy': ['Mel', 'Duc']}));
  });
  // Mel has term time (every weekday pattern), Duc has the July holidays — plus a week at Grandma's
  const days = await C.evaluate(() => {
    saveCustody(spacesList()[0], [0, 1, 2, 3, 4, 5, 6], false, [
      {from: '2026-09-19', to: '2026-10-04', who: 'Duc'},
      {from: '2026-10-05', to: '2026-10-09', who: 'Grandma'}]);
    return {
      term: custodyOn('hh-huy', '2026-08-12'),
      holiday: custodyOn('hh-huy', '2026-09-25'),
      grandma: custodyOn('hh-huy', '2026-10-07'),
      after: custodyOn('hh-huy', '2026-10-12'),
      holidayLabel: custodyLabel('hh-huy', '2026-09-25'),
      grandmaLabel: custodyLabel('hh-huy', '2026-10-07'),
    };
  });
  check('#13 term time follows the weekly pattern (with Mel)', days.term === 'me', JSON.stringify(days));
  check('#13 the school holidays override it (Duc\'s time)', days.holiday === 'them', JSON.stringify(days));
  check('#13 a THIRD caregiver is a first-class answer', days.grandma === 'name:Grandma', JSON.stringify(days));
  check('#13 …with an honest label', /kids with Grandma/i.test(days.grandmaLabel), days.grandmaLabel);
  check('#13 after the range, back to the pattern', days.after === 'me');
  check('#13 the holiday label names the other parent', /Duc/.test(days.holidayLabel), days.holidayLabel);

  // the sheet UI end-to-end: add a range, save, banner reflects it
  await C.evaluate(() => openCustody(spacesList()[0]));
  await C.waitForTimeout(200);
  check('#13 sheet lists the saved ranges', /Duc/.test(await C.locator('#custodyRanges').textContent()));
  await C.fill('#crFrom', '2026-12-19');
  await C.fill('#crTo', '2027-01-10');
  await C.fill('#crWho', 'Duc');
  await C.click('#crAddBtn');
  await C.waitForTimeout(150);
  check('#13 a new summer-holidays range joins the draft', /(19.{0,2}Dec|Dec.{0,2}19)/.test(await C.locator('#custodyRanges').textContent()),
    await C.locator('#custodyRanges').textContent());
  await C.click('#custodySave');
  await C.waitForTimeout(200);
  check('#13 saved: Christmas holidays resolve to Duc',
    await C.evaluate(() => custodyOn('hh-huy', '2026-12-25') === 'them'));
  // a bad range is refused
  await C.evaluate(() => openCustody(spacesList()[0]));
  await C.fill('#crFrom', '2027-02-10');
  await C.fill('#crTo', '2027-02-01');
  await C.fill('#crWho', 'Duc');
  await C.click('#crAddBtn');
  await C.waitForTimeout(150);
  check('#13 an end-before-start range is refused',
    !/(1.{0,2}Feb 2027|Feb.{0,2}1, 2027)/.test(await C.locator('#custodyRanges').textContent()));
  await C.click('#custodyCancel');
  // removing a range works and cancel doesn't persist drafts
  const still = await C.evaluate(() => (getCustody('hh-huy').ranges || []).length);
  check('#13 cancel leaves the saved schedule untouched', still === 3, String(still));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
