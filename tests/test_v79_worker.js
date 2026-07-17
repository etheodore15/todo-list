// v79: Cooee Phase 1d + Phase 2 — the worker flows, on top of the v78 roles.
// - Scoped sync: circle workers/viewers listen via the three PROVEN filtered
//   query shapes (the v78 rules refuse unfiltered lists for them); owners and
//   every other space type keep the single unfiltered listener.
// - Circle writes are stamped vis + authorUid so the rules (and the filtered
//   queries) can see them; other space types push unchanged payloads.
// - Session brackets: start/end support events pairing via a bracket id,
//   12h auto-close with an honest marker, NO duration totals anywhere.
// - Incident capture: structured, 'team'-scoped, non-notifying copy.
// - The structuring prompt knows circle vocabulary when a circle is the
//   capture destination.
const { chromium } = require('playwright');

const MANAGED = `window.MANAGED = {apiKey:'k', authDomain:'x', projectId:'p', appId:'1'};`;
const FAKE_APP = `export function initializeApp(cfg, name){ return {cfg, name}; }`;
const FAKE_AUTH = `
  export function getAuth(app){ if(!app.__a) app.__a={currentUser:null,ls:[]}; return app.__a; }
  export function onAuthStateChanged(a, cb){ a.ls.push(cb); if(a.currentUser) setTimeout(()=>cb(a.currentUser),0); return ()=>{}; }
  export async function signInAnonymously(a){ a.currentUser={uid:'u1', getIdToken: async()=>'T'}; a.ls.forEach(cb=>cb(a.currentUser)); return {user:a.currentUser}; }`;
// records every setDoc and every listener registration (incl. query filters)
const FAKE_FS = `
  export function initializeFirestore(){ return {}; }
  export function persistentLocalCache(){ return {}; }
  export function collection(db,...p){ return {path:p.join('/')}; }
  export function doc(db,...p){ return {path:p.join('/'), id:p[p.length-1]}; }
  export function query(col, ...cs){ return {path:col.path, filters:cs}; }
  export function where(f, op, v){ return {f, op, v}; }
  export async function setDoc(ref, data, opts){ (window.__writes = window.__writes || []).push({path:ref.path, data, opts}); }
  export async function deleteDoc(){}
  export async function getDoc(){ return {exists:()=>false, data:()=>null}; }
  export function onSnapshot(t, cb){ (window.__listens = window.__listens || []).push({path:t.path, filters:t.filters || null});
    cb({docChanges:()=>[]}); return ()=>{}; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0;
  const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + n); c ? pass++ : fail++; };
  const errors = [];

  const mk = async (init) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/managed-config.js', r => r.fulfill({ contentType: 'application/javascript', body: MANAGED }));
    await ctx.route('**/vendor/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_APP }));
    await ctx.route('**/vendor/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_AUTH }));
    await ctx.route('**/vendor/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_FS }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('onboarded', 'true'); } catch(e){} });
    if (init) await p.addInitScript(init);
    await p.goto('http://localhost:8906/app.html', { waitUntil: 'load' });
    await p.waitForTimeout(600);
    return p;
  };

  const seedWorker = () => {
    localStorage.setItem('myName', JSON.stringify('Ana'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cir', name: 'Blaire’s Circle', type: 'circle', cfg: null, managed: true, role: 'worker',
       circle: {participant: 'Blaire', mode: 'self'}},
      {hid: 'hh-fam', name: 'Home', type: 'family', cfg: null, managed: true}]));
    localStorage.setItem('spaceMembers', JSON.stringify({'hh-cir': ['Blaire', 'Ana', 'Jo']}));
  };

  // ---------- 1. scoped sync: who may listen how ----------
  const A = await mk(seedWorker);
  const listensFor = (p, path) => p.evaluate((pth) =>
    (window.__listens || []).filter(l => l.path === pth), path);
  const cirItems = await listensFor(A, 'households/hh-cir/items');
  check('v79: worker syncs a circle via exactly 3 filtered queries',
    cirItems.length === 3 && cirItems.every(l => Array.isArray(l.filters) && l.filters.length));
  const shapes = JSON.stringify(cirItems.map(l => l.filters));
  check('v79: the shapes are the three the rules matrix proved',
    /"f":"vis","op":"==","v":"circle"/.test(shapes) &&
    /"f":"vis","op":"==","v":"assigned"/.test(shapes) &&
    /"f":"visUids","op":"array-contains","v":"u1"/.test(shapes) &&
    /"f":"authorUid","op":"==","v":"u1"/.test(shapes));
  const famItems = await listensFor(A, 'households/hh-fam/items');
  check('v79: the family space keeps its single unfiltered listener',
    famItems.length === 1 && famItems[0].filters === null);

  const B = await mk(() => {
    localStorage.setItem('myName', JSON.stringify('Blaire'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cir', name: 'My Circle', type: 'circle', cfg: null, managed: true, role: 'owner'}]));
  });
  const ownItems = await listensFor(B, 'households/hh-cir/items');
  check('v79: the owner lists the whole circle unfiltered',
    ownItems.length === 1 && ownItems[0].filters === null);

  // ---------- 2. circle writes carry vis + authorUid; others unchanged ----------
  await A.evaluate(() => { window.__writes = []; });
  await A.evaluate(() => {
    todos.push({id: 't-cir', text: 'Buy picture cards', priority: 'low', space: 'hh-cir'});
    todos.push({id: 't-fam', text: 'Bins out', priority: 'low', space: 'hh-fam'});
    store.set('todos', todos);
    syncPush();
  });
  await A.waitForTimeout(300);
  const writes = await A.evaluate(() => window.__writes || []);
  const wCir = writes.find(w => w.path === 'households/hh-cir/items/t-cir');
  const wFam = writes.find(w => w.path === 'households/hh-fam/items/t-fam');
  check('v79: circle item stamped vis:circle + my authorUid',
    wCir && wCir.data.vis === 'circle' && wCir.data.authorUid === 'u1');
  check('v79: family item payload has no vis/authorUid keys (regression)',
    wFam && !('vis' in wFam.data) && !('authorUid' in wFam.data));

  // journal note into the circle: event stamped too
  await A.evaluate(() => { window.__writes = []; captureDest = 'hh-cir'; });
  await A.fill('#liveText', 'Blaire enjoyed the pool session today');
  await A.evaluate(() => document.getElementById('saveNoteBtn').click());
  await A.waitForTimeout(400);
  const evW = await A.evaluate(() => (window.__writes || []).find(w => /households\/hh-cir\/events\//.test(w.path)));
  check('v79: circle journal note is a vis:circle event with authorUid',
    evW && evW.data.kind === 'note' && evW.data.vis === 'circle' && evW.data.authorUid === 'u1');

  // ---------- 3. session brackets ----------
  await A.click('nav.tabs button[data-view="today"]');
  await A.evaluate(() => { window.__writes = []; activeSpace = 'hh-cir'; renderTodos(); });
  await A.waitForTimeout(200);
  const barText = () => A.evaluate(() => document.getElementById('spaceBar').textContent);
  check('v79: worker bar offers Start support + Report incident',
    /Start support/.test(await barText()) && /Report incident/.test(await barText()));
  await A.locator('.space-act', { hasText: 'Start support' }).click();
  await A.waitForTimeout(300);
  check('v79: starting logs a session-start event, scoped to the circle', await A.evaluate(() =>
    (window.__writes || []).some(w => /events/.test(w.path) && w.data.kind === 'session-start'
      && w.data.vis === 'circle' && w.data.authorUid === 'u1')));
  check('v79: the button flips to End support', /End support/.test(await barText()));
  await A.locator('.space-act', { hasText: 'End support' }).click();
  await A.waitForTimeout(300);
  const sesEvs = await A.evaluate(() => JSON.parse(localStorage.getItem('events'))
    .filter(e => e.kind === 'session-start' || e.kind === 'session-end'));
  check('v79: start and end pair via the same bracket id',
    sesEvs.length === 2 && sesEvs[0].taskId === sesEvs[1].taskId);
  check('v79: no open session remains', await A.evaluate(() => openSessionOn('hh-cir') === null));

  // auto-close: a bracket left open 13h ago closes at boot, honestly marked
  const C = await mk(() => {
    localStorage.setItem('myName', JSON.stringify('Ana'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cir', name: 'Circle', type: 'circle', cfg: null, managed: true, role: 'worker'}]));
    localStorage.setItem('openSessions', JSON.stringify({'hh-cir': {sesId: 'ses-old', start: Date.now() - 13 * 3600000}}));
  });
  const autoEv = await C.evaluate(() => JSON.parse(localStorage.getItem('events') || '[]')
    .find(e => e.kind === 'session-end' && e.taskId === 'ses-old'));
  check('v79: forgotten bracket auto-closes with an honest marker',
    !!autoEv && /automatically/.test(autoEv.detail || ''));
  check('v79: auto-close clears the open-session state',
    await C.evaluate(() => openSessionOn('hh-cir') === null));

  // ---------- 4. incident capture ----------
  await A.evaluate(() => { document.getElementById('liveText').value = 'Blaire slipped near the shower'; });
  await A.locator('.space-act', { hasText: 'Report incident' }).click();
  await A.waitForTimeout(200);
  check('v79: incident sheet opens with the non-notifying promise',
    await A.locator('#incidentSheet').isVisible() &&
    /does not notify/.test(await A.locator('#incidentSheet').textContent()) &&
    /NDIS Commission/.test(await A.locator('#incidentSheet').textContent()));
  check('v79: the dictated capture text seeds "what happened" (voice-fillable)',
    (await A.locator('#incWhat').inputValue()) === 'Blaire slipped near the shower');
  await A.fill('#incWhat', 'Blaire slipped in the bathroom');
  await A.fill('#incWho', 'just us');
  await A.fill('#incAction', 'helped up, no injury, rested after');
  await A.evaluate(() => { window.__writes = []; });
  await A.click('#incSave');
  await A.waitForTimeout(300);
  const incW = await A.evaluate(() => (window.__writes || []).find(w => /events/.test(w.path) && w.data.kind === 'incident'));
  check('v79: incident is a team-scoped event with an honest author',
    incW && incW.data.vis === 'team' && incW.data.authorUid === 'u1');
  check('v79: structure lands in the detail (present + action taken)',
    incW && /present: just us/.test(incW.data.detail) && /action taken: helped up/.test(incW.data.detail));
  check('v79: sheet closed and cleared after saving',
    await A.evaluate(() => document.getElementById('incidentSheet').style.display === 'none'
      && document.getElementById('incWhat').value === ''));

  // ---------- 5. viewers are read-only ----------
  const D = await mk(() => {
    localStorage.setItem('myName', JSON.stringify('Nan'));
    localStorage.setItem('spaces', JSON.stringify([
      {hid: 'hh-cir', name: 'Circle', type: 'circle', cfg: null, managed: true, role: 'viewer'}]));
  });
  await D.click('nav.tabs button[data-view="today"]');
  await D.evaluate(() => { activeSpace = 'hh-cir'; renderTodos(); });
  await D.waitForTimeout(200);
  const dBar = await D.evaluate(() => document.getElementById('spaceBar').textContent);
  check('v79: viewer bar hides every write action',
    !/Start support/.test(dBar) && !/Report incident/.test(dBar) && !/Add a note/.test(dBar) &&
    /About Me/.test(dBar) && /History/.test(dBar));
  check('v79: viewer gets no journal-save on capture', await D.evaluate(() => {
    captureDest = 'hh-cir';
    refreshCaptureMode();
    return document.getElementById('saveNoteBtn').style.display === 'none';
  }));

  // ---------- 6. the circle-aware structuring prompt (Phase 1d) ----------
  const prompt = await A.evaluate(() => { captureDest = 'hh-cir'; return buildIdeaPrompt('book the OT review'); });
  check('v79: prompt names the circle, the participant, and the members',
    /Blaire’s Circle/.test(prompt) && /around Blaire/.test(prompt) && /Ana, Jo/.test(prompt));
  check('v79: prompt keeps observations out of the task list',
    /journal material, NOT tasks/.test(prompt));
  check('v79: prompt knows session vocabulary and refuses surveillance',
    /support session, not a meeting/.test(prompt) && /surveillance/.test(prompt));
  const famPrompt = await A.evaluate(() => { captureDest = 'hh-fam'; return buildIdeaPrompt('bins out tonight'); });
  check('v79: non-circle prompts are untouched (regression)',
    !/support circle/.test(famPrompt) && !/surveillance/.test(famPrompt));

  // ---------- 7. history renders sessions + incidents as records ----------
  await A.evaluate(() => {
    histEvents = [
      {id: 'e3', ts: 3000, who: 'Ana', kind: 'session-end', taskId: 'ses-1', text: 'support session'},
      {id: 'e2', ts: 2000, who: 'Ana', kind: 'note', taskId: 'n1', text: 'calm afternoon'},
      {id: 'e2b', ts: 1800, who: 'Ana', kind: 'incident', taskId: 'i1', text: 'slipped in the bathroom', detail: 'present: just us'},
      {id: 'e1', ts: 1000, who: 'Ana', kind: 'session-start', taskId: 'ses-1', text: 'support session'}];
    histPrevSeen = 0;
    renderHistory();
  });
  const histHtml = await A.evaluate(() => document.getElementById('histList').innerHTML);
  check('v79: session lines styled as records, end line counts its entries',
    /hist-session/.test(histHtml) && /2 entries during it/.test(histHtml));
  check('v79: incident line distinct and worded as a report',
    /hist-incident/.test(histHtml) && /reported an incident/.test(histHtml));
  check('v79: no duration appears anywhere in the session card',
    !/\d+\s*(h|hr|hour|min)/i.test(histHtml.match(/hist-session[^<]*<[^>]*>[^<]*/g)?.join('') || ''));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
