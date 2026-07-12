const { chromium } = require('playwright');
// Production LLM (Qwen2.5-0.5B) through the app's worker: load + summarize with JSON check.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
  await page.evaluate(() => aiCall('config', { remoteHost: 'http://localhost:8906/testmodels/', llmDtype: 'q8' }));

  console.log('loading Qwen2.5-0.5B q8 (WASM)...');
  const t0 = Date.now();
  const load = await page.evaluate(() => aiCall('load-llm').catch(e => ({ error: e.message })));
  console.log('load-llm:', JSON.stringify(load), `(${Math.round((Date.now() - t0) / 1000)}s)`);
  if (load.error) { await browser.close(); process.exit(1); }

  const t1 = Date.now();
  const sum = await page.evaluate(() =>
    aiCall('summarize', { text: "I urgently need to call the accountant today about the tax deadline, and I should book the car in for a service this week, and maybe someday repaint the fence" })
      .catch(e => ({ error: e.message })));
  console.log('summarize:', JSON.stringify(sum).slice(0, 700), `(${Math.round((Date.now() - t1) / 1000)}s)`);

  const j = sum.json;
  const ok = j && j.summary && Array.isArray(j.tasks) && j.tasks.length >= 2 &&
             j.tasks.every(t => t.text && ['high','medium','low'].includes(t.priority));
  console.log(ok ? 'PASS: valid summary+tasks JSON from production model' : 'FAIL: bad output');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
