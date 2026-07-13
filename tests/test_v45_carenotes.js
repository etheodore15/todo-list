// v45: (1) voice/typed captures can be SAVED as a care journal note straight
// from the capture screen (they were previously only savable via a two-step
// Ideas → "Share to space" dance, so caregivers thought records vanished);
// (2) the doctor briefing never hangs — it renders in-app with a no-AI fallback.
const { chromium } = require('playwright');

const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_FS = `
export function initializeFirestore(app){ return {app}; }
export function persistentLocalCache(){ return {}; }
export function collection(db, ...p){ return {path: p.join('/')}; }
export function doc(db, ...p){ return {path: p.join('/'), id: p[p.length-1]}; }
export async function setDoc(){ }
export async function deleteDoc(){ }
export async function getDoc(){ return {exists: () => false, data: () => null}; }
export function onSnapshot(col, cb){ cb({docChanges: () => []}); return () => {}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const ctx = await browser.newContext();
  await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
  await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
  await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('cohorts', JSON.stringify(['caregiving']));
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('careProfile', JSON.stringify({'hh-care':{name:'Margaret', age:'82'}}));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
    // NOTE: no geminiKey — the briefing must still work with NO AI.
  });
  await p.goto('http://localhost:8906/', { waitUntil: 'load' });
  await p.waitForTimeout(400);

  // ---------- capture screen is care-aware ----------
  await p.click('nav.tabs button[data-view="capture"]');
  await p.waitForTimeout(150);
  check('v45: capture offers “Save note” when a care space is in context',
    await p.locator('#saveNoteBtn').isVisible());
  check('v45: the note button names the journal',
    /Mum's care journal/.test(await p.locator('#saveNoteBtn').textContent()));

  // ---------- save a care note straight from capture ----------
  await p.fill('#liveText', 'Mum ate a full lunch today but seemed confused in the afternoon.');
  await p.click('#saveNoteBtn');
  await p.waitForTimeout(200);
  const saved = await p.evaluate(() => {
    const evs = JSON.parse(localStorage.getItem('events') || '[]');
    const note = evs.find(e => e.kind === 'note' && e.space === 'hh-care');
    const idea = JSON.parse(localStorage.getItem('ideas') || '[]')[0];
    return {noteText: note && note.text, ideaShared: idea && (idea.sharedTo || []).includes('hh-care'),
      cleared: document.getElementById('liveText').value === ''};
  });
  check('v45: the note is saved to the care journal (a note event)',
    !!saved.noteText && /full lunch/.test(saved.noteText));
  check('v45: a private copy is kept in Ideas, marked shared to the space', saved.ideaShared === true);
  check('v45: the capture box is cleared after saving', saved.cleared);

  // ---------- doctor briefing: NO AI, must not hang, must show the note ----------
  await p.click('nav.tabs button[data-view="today"]');
  await p.waitForTimeout(200);
  await p.evaluate(() => openHistory(spacesList().find(s => s.hid === 'hh-care')));
  await p.waitForTimeout(300);
  check('v45: care history shows the Doctor briefing button', await p.locator('#histBriefBtn').isVisible());
  // this is the action the user said "hangs at preparing"
  await p.click('#histBriefBtn');
  await p.waitForTimeout(800);   // localBriefing is instant; a hang would exceed this and fail below
  check('v45: briefing opens in-app (no hang, no pop-up dependency)',
    await p.locator('#briefOverlay').isVisible());
  const briefText = await p.locator('#briefBody').textContent();
  check('v45: briefing includes the captured observation', /full lunch/.test(briefText));
  check('v45: briefing has a coordination overview', /coordination summary/i.test(briefText));
  check('v45: briefing offers Print / Save PDF', await p.locator('#briefPrint').isVisible());
  check('v45: the briefing button reset (not stuck on “Preparing…”)',
    /Doctor briefing/.test(await p.locator('#histBriefBtn').textContent()));

  // Escape closes it
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  check('v45: Escape closes the briefing overlay', !(await p.locator('#briefOverlay').isVisible()));

  // ---------- non-care context does NOT show the note button ----------
  const ctx2 = await browser.newContext();
  await ctx2.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
  const q = await ctx2.newPage();
  await q.addInitScript(() => localStorage.setItem('onboarded', 'true'));
  await q.goto('http://localhost:8906/', { waitUntil: 'load' });
  await q.waitForTimeout(300);
  await q.click('nav.tabs button[data-view="capture"]');
  await q.waitForTimeout(150);
  check('v45: no “Save note” button without a care space',
    !(await q.locator('#saveNoteBtn').isVisible()));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
