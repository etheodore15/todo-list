const { chromium } = require('playwright');

// Full end-to-end test of the on-device AI stack: vendored transformers.js +
// ONNX WASM runtime + real whisper-base weights (served locally) transcribing
// real synthesized speech, all through the app's own worker bridge (aiCall).
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });

  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });

  // Point the worker's model hub at the locally-served copies.
  await page.evaluate(() => aiCall('config', { remoteHost: 'http://localhost:8906/testmodels/' }));

  console.log('loading whisper-base (local files, WASM backend)...');
  const t0 = Date.now();
  const load = await page.evaluate(() => aiCall('load-asr').catch(e => ({ error: e.message })));
  console.log('load-asr:', JSON.stringify(load), `(${Math.round((Date.now() - t0) / 1000)}s)`);
  if (load.error) { console.log('LOAD FAILED'); await browser.close(); process.exit(1); }

  // Decode the espeak-generated WAV in the page and transcribe via the worker.
  const t1 = Date.now();
  const tr = await page.evaluate(async () => {
    const buf = await (await fetch('testmodels/sample.wav')).arrayBuffer();
    const probe = new OfflineAudioContext(1, 1, 16000);
    const decoded = await probe.decodeAudioData(buf);
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    const audio = rendered.getChannelData(0);
    return aiCall('transcribe', { audio }, [audio.buffer]).catch(e => ({ error: e.message }));
  });
  console.log('transcribe:', JSON.stringify(tr), `(${Math.round((Date.now() - t1) / 1000)}s)`);

  const text = (tr.text || '').toLowerCase();
  const hit = ['call', 'plumber', 'tomorrow', 'hot water'].filter(w => text.includes(w));
  console.log(`keywords found: ${hit.length}/4 (${hit.join(', ')})`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
  process.exit(tr.error || hit.length < 3 ? 1 : 0);
})();
