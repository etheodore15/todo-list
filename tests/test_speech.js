const { chromium } = require('playwright');

// Simulates Android Chrome's SpeechRecognition quirk: every onresult event
// re-delivers the ENTIRE cumulative transcript (often marked final, often with
// duplicate entries), instead of only the new words.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      constructor(){ window.__rec = this; }
      start(){} stop(){} abort(){}
    };
  });

  await page.goto('http://localhost:8902/', { waitUntil: 'networkidle' });

  const fire = (parts) => page.evaluate((parts) => {
    const results = parts.map(t => {
      const r = [{ transcript: t }];
      r.isFinal = true;
      return r;
    });
    results.resultIndex = 0;
    window.__rec.onresult({ resultIndex: 0, results });
  }, parts);

  await page.click('#micBtn'); // startRec

  // Android-style cumulative re-delivery, growing each event, with a duplicate:
  const utterance = "Lulu's present has been delivered it needs to come inside";
  const words = utterance.split(' ');
  for (let i = 1; i <= words.length; i++) {
    const partial = words.slice(0, i).join(' ');
    await fire([partial]);
  }
  await fire([utterance, utterance]); // duplicated final result (Samsung quirk)

  let value = await page.inputValue('#liveText');
  console.log('after cumulative events:', JSON.stringify(value));
  console.log(value === utterance ? 'PASS: no duplication' : 'FAIL: duplicated text');

  // Engine auto-restart mid-utterance: onend fires, results list resets.
  await page.evaluate(() => window.__rec.onend());
  await fire(['and shut the door']);
  value = await page.inputValue('#liveText');
  const expected = utterance + ' and shut the door';
  console.log('after restart:', JSON.stringify(value));
  console.log(value === expected ? 'PASS: restart preserved text once' : 'FAIL: restart broke text');

  // Mode 2: Android appends each growing partial as a SEPARATE results entry,
  // including a mid-utterance revision of the first word.
  await page.click('#clearBtn');
  await page.evaluate(() => window.__rec.onend && null); // no-op, keep session
  const grow = [];
  const words2 = "Lily's Lulu's present has been delivered".split(' ');
  // partials: "Lily's", "Lulu's present", "Lulu's present has", ...
  grow.push("Lily's");
  for (let i = 1; i < words2.length; i++) grow.push(words2.slice(1, i + 1).join(' '));
  for (let i = 1; i <= grow.length; i++) await fire(grow.slice(0, i));
  value = await page.inputValue('#liveText');
  const expected2 = "Lulu's present has been delivered";
  console.log('growing-list mode:', JSON.stringify(value));
  console.log(value === expected2 ? 'PASS: growing-list collapsed' : 'FAIL: growing-list duplicated');

  // Two genuinely separate segments must still both survive.
  await page.click('#clearBtn');
  await fire(['call the plumber']);
  await fire(['call the plumber', 'buy dog food']);
  value = await page.inputValue('#liveText');
  console.log('two segments:', JSON.stringify(value));
  console.log(value === 'call the plumber buy dog food' ? 'PASS: distinct segments kept' : 'FAIL: segment lost');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
})();
