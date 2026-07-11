const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  await page.evaluate(() => aiCall('config', {
    remoteHost: 'http://localhost:8906/testmodels/',
    llmModel: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    llmDtype: 'q4',   // allows WASM path for this test
  }));

  console.log('loading stand-in LLM (176MB, WASM)...');
  const t0 = Date.now();
  const load = await page.evaluate(() => aiCall('load-llm').catch(e => ({ error: e.message })));
  console.log('load-llm:', JSON.stringify(load), `(${Math.round((Date.now() - t0) / 1000)}s)`);
  if (load.error) { await browser.close(); process.exit(1); }

  const t1 = Date.now();
  const sum = await page.evaluate(() =>
    aiCall('summarize', { text: 'I urgently need to call the accountant today about the tax deadline and book the dentist this week' })
      .catch(e => ({ error: e.message })));
  console.log('summarize:', JSON.stringify(sum).slice(0, 400), `(${Math.round((Date.now() - t1) / 1000)}s)`);

  // A 135M model may produce imperfect JSON — what we're validating is that the
  // pipeline call, chat templating, and parsing code all work, or fail with the
  // specific graceful error the app handles.
  const ok = sum.json || (sum.error && /no JSON|JSON/.test(sum.error));
  console.log(ok ? 'PASS: summarize path works' : 'FAIL: unexpected failure');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
