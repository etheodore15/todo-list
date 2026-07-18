// v86: the care register — med/appointment noun-phrases must become tasks.
// Every sentence here produced ZERO tasks in the 44-persona study (persona
// study finding #1); each now must yield at least the expected count. Plus
// guards: past-tense speech still filtered, plain chatter still ignored.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' — ' + (extra || ''))); cond ? pass++ : fail++; };

  await page.addInitScript(() => { try { localStorage.setItem('onboarded', 'true'); } catch (e) {} });
  await page.goto('http://localhost:8906/app.html', { waitUntil: 'networkidle' });

  // drive localSummarize directly — deterministic, no AI in the loop
  const extract = (text) => page.evaluate(t => localSummarize(t).tasks.map(x => ({text: x.text, recur: !!x.recur, time: x.time || null, date: x.date || null})), text);

  const CASES = [
    // [capture, min tasks, label, needRecur?, needTime?]
    ['Dad donepezil every day at 8am', 1, 'med noun + every day + time', true, true],
    ['Charlie Keppra every day at 8am and 8pm never miss it', 1, 'seizure meds twice daily', true, true],
    ['Ray levodopa at 7am 1pm and 7pm every day', 1, 'parkinsons tri-dose', true, true],
    ['Daniel thyroxine every morning before breakfast', 1, 'thyroxine every morning', true, false],
    ['Lithium every night at 9', 1, 'lithium nightly', true, false],
    ['Hydroxychloroquine every morning', 1, 'self-managed daily med', true, false],
    ['Banjo phenobarb at 8am and 8pm every day', 1, 'pet meds', true, true],
    ["Mum's injection every Tuesday night", 1, 'weekly injection', true, false],
    ['Ruby speech therapy next Tuesday at 10am', 1, 'therapy appointment', false, true],
    ['Physio Monday and Thursday at 9 speech therapy Tuesday hydro Friday every week', 1, 'rehab timetable', false, false],
    ['Chem assessment Thursday and shift Saturday 5 to 9', 2, 'school + work noun phrases', false, false],
    ['Ari eye patching one hour every day this week', 1, 'patching routine', true, false],
    ["Nick's formal suit hire by the 20th", 1, 'formal suit hire', false, false],
    ['Sofia needs new footy boots and Diego has a dentist appointment Thursday and someone has to bake for the fete', 3, 'family multi-kid sentence', false, false],
    ["Confirm Lola's new blood thinner dose with the cardiologist Friday", 1, 'confirm (new verb)', false, false],
    ["Replace Huy's EpiPen before it expires on the 30th of September", 1, 'replace (new verb)', false, false],
    ['Mark the tutorial quizzes by Friday', 1, 'mark (new verb)', false, false],
    ['Practice the bus route to the nursery with Jade on Thursday', 1, 'practice (new verb)', false, false],
    ['Quote the Bell St bathroom Thursday and order the mixer taps and invoice the Hendersons', 3, 'quote/invoice (new verbs)', false, false],
    ["Sign Ella's sport permission note tonight and Josh needs poster cardboard by Wednesday", 2, 'sign + possessive needs', false, false],
    ['Clean the oven before the inspection and someone needs to fix the flyscreen', 2, 'needs-to clause splits', false, false],
    ['Centrelink appointment Tuesday 10am bring the bank letter and Ayaan audiology Thursday at the hospital', 2, 'two appointments', false, false],
    ['Worm Banjo every three months', 1, 'worm (new verb)', false, false],
  ];
  for (const [text, min, label, needRecur, needTime] of CASES) {
    const ts = await extract(text);
    check(`${label}: ≥${min} task(s)`, ts.length >= min, `got ${ts.length}: ${JSON.stringify(ts.map(t => t.text))}`);
    if (needRecur && ts.length) check(`${label}: recurrence parsed`, ts.some(t => t.recur), JSON.stringify(ts));
    if (needTime && ts.length) check(`${label}: a time parsed`, ts.some(t => t.time), JSON.stringify(ts));
  }

  // guards: what must NOT become tasks
  const NEG = [
    ['I already gave Dad his donepezil this morning', 'past-tense med talk stays filtered'],
    ['We had a lovely chat about the garden', 'plain chatter ignored'],
    ['Ballanta dhakhtarka waa isniinta soo socota', 'non-English still yields no phantom tasks'],
  ];
  for (const [text, label] of NEG) {
    const ts = await extract(text);
    check(label, ts.length === 0, `got ${JSON.stringify(ts.map(t => t.text))}`);
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
