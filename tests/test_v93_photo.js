// v93: photo capture — snap → recognize text (AI) or snap → photo note.
// The OCR response is mocked at the network layer; everything else is real:
// compression, preview strip, the pipeline from recognized text to tasks,
// photo notes into the journal/record, and the local photo budget.
const { chromium } = require('playwright');
const zlib = require('zlib');

// a tiny valid 8x8 red PNG, generated raw (no fixtures needed)
function tinyPng(){
  const w = 8, h = 8;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++){ raw[y * (1 + w * 3)] = 0; for (let x = 0; x < w; x++){ raw[y * (1 + w * 3) + 1 + x * 3] = 200; } }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let crc = 0xffffffff; for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const cb = Buffer.alloc(4); cb.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, cb]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' — ' + (extra || ''))); cond ? pass++ : fail++; };
  const errors = [];
  const OCR_TEXT = 'School notice: return the excursion permission form by Friday and pay the $12 activity fee';

  const mk = async (init, mockOcr) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    if (mockOcr){
      // a user key routes OCR straight to generativelanguage — mock that host,
      // abort everything else (no auth dance needed)
      await ctx.route(/generativelanguage\.googleapis\.com/, r => r.fulfill({ contentType: 'application/json',
        body: r.request().url().includes(':generateContent')
          ? JSON.stringify({ candidates: [{ content: { parts: [{ text: OCR_TEXT }] } }] })
          : JSON.stringify({ models: [{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }] }) }));
      await ctx.route(/cloudfunctions|firebaseio|gstatic|firebaseapp|(?<!generativelanguage\.)googleapis\.com/, r => r.abort());
    } else {
      await ctx.route(/googleapis|firebaseio|cloudfunctions|gstatic|firebaseapp/, r => r.abort());
    }
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(init || (() => localStorage.setItem('onboarded', 'true')));
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    return p;
  };
  const snap = async (p) => {
    await p.setInputFiles('#photoInput', { name: 'snap.png', mimeType: 'image/png', buffer: tinyPng() });
    await p.waitForTimeout(400);
  };

  // ---------- 1. snap → preview strip ----------
  const A = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Rosa'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-casa', name: 'Casa Medina', type: 'family', cfg: null}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-casa'));
    localStorage.setItem('geminiKey', JSON.stringify('test-key'));
    localStorage.setItem('geminiModel', JSON.stringify('gemini-2.0-flash'));
  }, true);
  await A.click('nav.tabs button[data-view="capture"]');
  check('the capture screen offers Snap a photo', await A.locator('#snapBtn').isVisible());
  await snap(A);
  check('the photo compresses into a preview', await A.locator('#photoStrip img').count() === 1);
  check('…with Read-text and Remove alongside',
    await A.locator('#photoStrip button', { hasText: 'Read text' }).count() === 1 &&
    await A.locator('#photoStrip button', { hasText: 'Remove' }).count() === 1);

  // ---------- 2. snap → text recognized → the normal pipeline ----------
  await A.locator('#photoStrip button', { hasText: 'Read text' }).click();
  await A.waitForFunction(() => document.getElementById('liveText').value.length > 0, null, { timeout: 10000 });
  const boxed = await A.inputValue('#liveText');
  check('recognized text lands in the capture box', boxed.includes('excursion permission form'), boxed);
  await A.click('#saveIdeaBtn');
  await A.waitForFunction(() => !(JSON.parse(localStorage.getItem('ideas') || '[]').some(i => i.pending)), null, { timeout: 20000 });
  const state = await A.evaluate(() => ({
    task: JSON.parse(localStorage.getItem('todos') || '[]').find(t => /permission form/i.test(t.text)),
    fee: JSON.parse(localStorage.getItem('todos') || '[]').find(t => /activity fee/i.test(t.text)),
    idea: JSON.parse(localStorage.getItem('ideas') || '[]')[0],
  }));
  check('the school notice becomes a real task in the space',
    state.task && state.task.space === 'hh-casa', JSON.stringify(state.task && {space: state.task.space}));
  check('…and the fee splits into its own task carrying the $12 expense',
    state.fee && state.fee.amount === 12, JSON.stringify(state.fee && {amount: state.fee.amount}));
  check('the photo stays on the note card', !!state.idea.photo);

  // ---------- 3. snap → photo note with a caption ----------
  await A.click('nav.tabs button[data-view="capture"]');
  await snap(A);
  await A.fill('#liveText', 'The rash on Mateo’s arm this morning');
  await A.click('#saveNoteBtn');
  await A.waitForTimeout(400);
  const noteEv = await A.evaluate(() => JSON.parse(localStorage.getItem('events') || '[]').find(e => e.kind === 'note' && /rash/i.test(e.text)));
  check('the photo note reaches the space record with its image',
    noteEv && !!noteEv.thumb && noteEv.space === 'hh-casa', JSON.stringify(noteEv && {thumb: !!noteEv.thumb, space: noteEv.space}));
  await A.click('nav.tabs button[data-view="ideas"]');
  await A.waitForTimeout(300);
  check('the Notes card shows the photo', await A.locator('#ideasList .card img').count() >= 1);
  await A.evaluate(() => openHistory(spacesList()[0]));
  await A.waitForTimeout(600);
  check('the space history shows the photo', await A.locator('#histList img').count() >= 1);
  await A.click('#histClose');

  // ---------- 4. photo with NO words is still a note ----------
  await A.click('nav.tabs button[data-view="capture"]');
  await snap(A);
  await A.click('#saveIdeaBtn');
  await A.waitForTimeout(400);
  const photoOnly = await A.evaluate(() => JSON.parse(localStorage.getItem('ideas') || '[]')[0]);
  check('a wordless snap saves as a photo note (never lost)',
    photoOnly && photoOnly.raw === 'Photo note' && !!photoOnly.photo, JSON.stringify(photoOnly && {raw: photoOnly.raw, photo: !!photoOnly.photo}));

  // ---------- 5. offline: no OCR promises, the photo still attaches ----------
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('apiKey', '');
    localStorage.setItem('geminiKey', '');
  }, false);
  await B.click('nav.tabs button[data-view="capture"]');
  await snap(B);
  const bStrip = await B.locator('#photoStrip').textContent();
  check('offline: photo attaches; Read-text follows aiEnabled()',
    await B.locator('#photoStrip img').count() === 1, bStrip);

  // ---------- 6. the local photo budget strips old thumbs, never text ----------
  const C = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Ines'));
    localStorage.setItem('spaces', JSON.stringify([{hid: 'hh-m', name: 'Mamma', type: 'care', cfg: null}]));
    const evs = [];
    for (let i = 0; i < 24; i++)
      evs.push({id: 'p' + i, ts: Date.now() - (30 - i) * 60000, kind: 'note', who: 'Ines', space: 'hh-m',
        taskId: 'n' + i, text: 'photo note ' + i, thumb: 'data:image/jpeg;base64,AAAA'});
    localStorage.setItem('events', JSON.stringify(evs));
  }, false);
  await C.evaluate(() => logEvent('note', {id: 'note-new', text: 'newest photo note', space: 'hh-m', thumb: 'data:image/jpeg;base64,BBBB'}));
  const budget = await C.evaluate(() => {
    const evs = JSON.parse(localStorage.getItem('events') || '[]');
    return {
      withThumb: evs.filter(e => e.thumb).length,
      textIntact: evs.filter(e => /photo note/.test(e.text)).length,
      newestKept: evs.find(e => /newest/.test(e.text)).thumb === 'data:image/jpeg;base64,BBBB',
      strippedFlagged: evs.some(e => e.photoStripped),
    };
  });
  check('local budget: at most 20 photo events keep their image', budget.withThumb === 20, JSON.stringify(budget));
  check('…the newest keeps its photo, text is never stripped',
    budget.newestKept && budget.textIntact === 25 && budget.strippedFlagged, JSON.stringify(budget));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
