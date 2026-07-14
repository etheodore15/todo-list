// v49: care shift-handoff card (notes + missed + others' actions since last
// visit) and a dialog focus-trap so keyboard users can't Tab out of a modal.
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

  const mk = async (seed) => {
    const ctx = await browser.newContext();
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MANAGED=null;' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    if (seed) await page.addInitScript(seed);
    await page.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return page;
  };

  // ---------- care shift-handoff card ----------
  const A = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('myName', JSON.stringify('Alex'));
    localStorage.setItem('lastSeenAt', JSON.stringify(1000));   // "last visit" long ago → events count
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-care', name:"Mum's care", type:'care', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('careProfile', JSON.stringify({'hh-care':{name:'Margaret'}}));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-care'));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
    const now = 1_700_000_000_000;
    localStorage.setItem('events', JSON.stringify([
      {id:'e1', ts: now, who:'Priya', kind:'note', text:'Ate a full lunch, a bit confused after', space:'hh-care'},
      {id:'e2', ts: now+1, who:null, kind:'missed', text:'Evening insulin', space:'hh-care', detail:'scheduled 9pm'},
      {id:'e3', ts: now+2, who:'Priya', kind:'ticked', text:'Morning meds', space:'hh-care'},
      {id:'e4', ts: now+3, who:'Alex', kind:'ticked', text:'Tidy room', space:'hh-care'}   // my own — should be hidden
    ]));
  });
  await A.click('nav.tabs button[data-view="today"]');
  await A.waitForTimeout(250);
  check('v49: care handoff card is shown on Today', await A.locator('#careHandoff .care-handoff').isVisible());
  const txt = await A.locator('#careHandoff').textContent();
  check('v49: card is titled "Since your last visit"', /Since your last visit/.test(txt));
  check('v49: includes a journal note', /full lunch/.test(txt));
  check('v49: includes a missed dose', /Evening insulin.*not recorded|not recorded.*Evening insulin/.test(txt));
  check('v49: includes what another carer did', /Priya.*Morning meds/.test(txt));
  check('v49: does NOT echo my own action back to me', !/Tidy room/.test(txt));
  // dismiss
  await A.locator('#careHandoff .ch-x').click();
  await A.waitForTimeout(120);
  check('v49: handoff card can be dismissed', !(await A.locator('#careHandoff .care-handoff').isVisible()));

  // a family space gets the neutral away banner, not the care card
  const B = await mk(() => {
    localStorage.setItem('onboarded', 'true');
    localStorage.setItem('spaces', JSON.stringify([{hid:'hh-fam', name:'Home', type:'family', cfg:{apiKey:'k',projectId:'p'}}]));
    localStorage.setItem('defaultSpace', JSON.stringify('hh-fam'));
    localStorage.setItem('fbConfig', JSON.stringify({apiKey:'k',projectId:'p'}));
  });
  await B.click('nav.tabs button[data-view="today"]');
  await B.waitForTimeout(200);
  check('v49: non-care space shows no care handoff card',
    !(await B.locator('#careHandoff .care-handoff').isVisible()));

  // ---------- dialog focus-trap ----------
  const C = await mk(() => localStorage.setItem('onboarded', 'true'));
  await C.click('nav.tabs button[data-view="today"]');
  await C.fill('#quickAdd', 'plan the trip'); await C.click('#quickAddBtn'); await C.waitForTimeout(120);
  // open the scope sheet (a dialog)
  await C.locator('.todo', { hasText: 'plan the trip' }).locator('.row-menu').click();
  await C.waitForTimeout(100);
  // actually open a real dialog: the focus overlay (Just one thing)
  await C.evaluate(() => openFocus());
  await C.waitForTimeout(150);
  check('v49: a dialog is open (focus overlay)',
    await C.evaluate(() => getComputedStyle(document.getElementById('focusOverlay')).display !== 'none'));
  // tab many times; focus must never leave the dialog
  let escaped = false;
  for (let i = 0; i < 12; i++){
    await C.keyboard.press('Tab');
    const inside = await C.evaluate(() => {
      const dlg = document.getElementById('focusOverlay');
      return dlg.contains(document.activeElement);
    });
    if (!inside){ escaped = true; break; }
  }
  check('v49: Tab stays trapped inside the open dialog', !escaped);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
