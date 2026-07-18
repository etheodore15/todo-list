// v87: multi-dose routines + count-what-was-heard honesty (persona study #2 + #10).
//  - A recurring routine with several am/pm times fans into one task per dose,
//    each with its own time slot (tick + missed-dose record each).
//  - The extraction cap rises 6→8 and overflow is COUNTED and said aloud.
//  - Dedupe is text+time so the 8pm dose isn't "already listed" via the 8am one.
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
  // record every toast so the honesty line is assertable
  await page.evaluate(() => { const orig = window.toast; window.toast = (m, ...a) => { (window.__toasts = window.__toasts || []).push(String(m)); return orig(m, ...a); }; });

  const capture = async (text) => {
    await page.click('nav.tabs button[data-view="capture"]');
    await page.fill('#liveText', text);
    await page.click('#saveIdeaBtn');
    await page.waitForFunction(() => !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, { timeout: 20000 });
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const ideas = JSON.parse(localStorage.getItem('ideas') || '[]');
      return JSON.parse(localStorage.getItem('todos') || '[]').filter(t => t.ideaId === ideas[0].id)
        .map(t => ({ text: t.text, time: t.time, recur: !!t.recur }));
    });
  };

  // ---------- #2: dose fan-out ----------
  const keppra = await capture('Charlie Keppra every day at 8am and 8pm never miss it');
  check('Keppra twice daily → 2 tasks', keppra.length === 2, JSON.stringify(keppra));
  check('Keppra doses at 08:00 and 20:00',
    keppra.map(t => t.time).sort().join(',') === '08:00,20:00', JSON.stringify(keppra));
  check('both Keppra doses recur', keppra.every(t => t.recur));

  const levo = await capture('Ray levodopa at 7am 1pm and 7pm every day');
  check('levodopa tri-dose → 3 tasks', levo.length === 3, JSON.stringify(levo));
  check('doses at 07:00, 13:00, 19:00',
    levo.map(t => t.time).sort().join(',') === '07:00,13:00,19:00', JSON.stringify(levo));

  const prev = await capture('Give Mateo his preventer every day at 7am and 7pm');
  check('preventer twice daily → 2 tasks', prev.length === 2, JSON.stringify(prev));

  // no fan-out without recurrence, and AND-splits stay separate tasks
  const single = await capture('Meet the accountant at 3pm on Friday');
  check('one-off with one time stays a single task', single.length === 1, JSON.stringify(single));
  const two = await capture('Book the dentist at 2pm and call the bank about the loan');
  check('two actions with one time each stay two distinct tasks',
    two.length === 2 && two[0].text !== two[1].text, JSON.stringify(two));

  // ---------- #2: text+time dedupe ----------
  const again = await capture('Charlie Keppra every day at 8am and 8pm never miss it');
  check('repeat capture: both doses recognised as already listed', again.length === 0, JSON.stringify(again));
  const skippedToast = await page.evaluate(() => (window.__toasts || []).slice(-1)[0] || '');
  check('repeat capture says "already on your list"', /already/.test(skippedToast), skippedToast);

  // ---------- #10: cap raised to 8, overflow counted and spoken ----------
  const NINE = 'Call the accountant and email the investor update and fix the billing bug and book the flights and renew the domain and buy the birthday present and organise the holiday program and cancel the old CRM and pay the insurance invoice';
  const eng = await page.evaluate(t => { const r = localSummarize(t); return { n: r.tasks.length, dropped: r.dropped }; }, NINE);
  check('9-action monologue keeps 8 tasks', eng.n === 8, JSON.stringify(eng));
  check('…and counts 1 dropped', eng.dropped === 1, JSON.stringify(eng));
  const eight = await capture(NINE);
  check('full pipeline lands 8 tasks', eight.length === 8, 'got ' + eight.length);
  const overflowToast = await page.evaluate(() => (window.__toasts || []).slice(-1)[0] || '');
  check('toast admits what didn’t fit', /1 more didn’t fit/.test(overflowToast), overflowToast);
  const engOk = await page.evaluate(t => localSummarize(t).dropped, 'Call the plumber and email the strata');
  check('no false overflow on small captures', engOk === 0, String(engOk));

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
