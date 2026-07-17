// Phase 1c gate: the role × scope × CRUD matrix for circle spaces, run against
// the Firestore emulator with the REAL firestore.rules. A worker token must
// not be able to read team-scoped docs even with a hand-crafted query — these
// tests are the security boundary's proof, not the UI.
//
// Run: npx firebase emulators:exec --only firestore --project demo-rules \
//        "node tests/rules/firestore-rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails }
  from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where }
  from 'firebase/firestore';

let pass = 0, fail = 0;
const check = async (name, promise, expect) => {
  try {
    await (expect === 'allow' ? assertSucceeds(promise) : assertFails(promise));
    console.log('PASS: ' + name); pass++;
  } catch (e) {
    console.log('FAIL: ' + name + ' — ' + (e.message || e)); fail++;
  }
};

const env = await initializeTestEnvironment({
  projectId: 'demo-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
await env.clearFirestore();

// ---------- seed (bypasses rules) ----------
const CIRCLE = 'hh-circle', FAMILY = 'hh-family';
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'households', CIRCLE), {
    name: "Blaire's Circle", type: 'circle', created: 1,
    circle: { participant: 'Blaire', mode: 'nominee' },
    members: {
      owner1:  { name: 'Blaire', role: 'owner' },
      admin1:  { name: 'Emile',  role: 'co-admin' },
      worker1: { name: 'Sam',    role: 'worker' },
      worker2: { name: 'Kim',    role: 'worker' },
      viewer1: { name: 'Coord',  role: 'viewer' },
      legacy1: 'StringPerson',            // defensive: must never rank as team
    },
  });
  await setDoc(doc(db, 'households', FAMILY), {
    name: 'Home', type: 'family', created: 1,
    members: { fam1: 'Alex', fam2: 'Lulu' },
  });
  const it = (id, data) => setDoc(doc(db, 'households', CIRCLE, 'items', id), data);
  await it('i-legacy',   { text: 'no vis field (legacy)', authorUid: 'admin1' });
  await it('i-circle',   { text: 'circle-wide', vis: 'circle', authorUid: 'admin1' });
  await it('i-team',     { text: 'team only', vis: 'team', authorUid: 'admin1' });
  await it('i-teamw',    { text: 'incident by worker1', vis: 'team', authorUid: 'worker1' });
  await it('i-assigned', { text: 'assigned to worker1', vis: 'assigned', authorUid: 'admin1', visUids: ['worker1'] });
  await it('i-private',  { text: 'private by worker1', vis: 'private', authorUid: 'worker1' });
  await setDoc(doc(db, 'households', CIRCLE, 'events', 'e-team'),
    { kind: 'incident', vis: 'team', authorUid: 'worker1', text: 'fall near the steps', ts: 1 });
  await setDoc(doc(db, 'households', CIRCLE, 'events', 'e-open'),
    { kind: 'note', authorUid: 'worker1', text: 'ate well', ts: 2 });
  await setDoc(doc(db, 'households', CIRCLE, 'receipts', 'r-team'),
    { amount: 40, vis: 'team', authorUid: 'admin1', ts: 1 });
  await setDoc(doc(db, 'households', FAMILY, 'items', 'f-1'), { text: 'bins' });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const item = (db, id) => doc(db, 'households', CIRCLE, 'items', id);

// ---------- household doc: read ----------
for (const uid of ['owner1', 'admin1', 'worker1', 'viewer1'])
  await check(`household get — ${uid}`, getDoc(doc(as(uid), 'households', CIRCLE)), 'allow');
await check('household get — non-member', getDoc(doc(as('stranger'), 'households', CIRCLE)), 'deny');
await check('household get — unauthenticated', getDoc(doc(anon(), 'households', CIRCLE)), 'deny');
await check('household list — always denied',
  getDocs(collection(as('owner1'), 'households')), 'deny');

// ---------- FULL READ MATRIX FIRST (before any membership mutation) ----------
// ---------- items: the read matrix ----------
const READS = [
  // [docId, uid, expect]
  ['i-legacy',   'owner1',  'allow'], ['i-legacy',   'worker1', 'allow'], ['i-legacy',   'viewer1', 'allow'],
  ['i-circle',   'worker1', 'allow'], ['i-circle',   'viewer1', 'allow'],
  ['i-team',     'owner1',  'allow'], ['i-team',     'admin1',  'allow'],
  ['i-team',     'worker1', 'deny'],  ['i-team',     'viewer1', 'deny'],  ['i-team', 'legacy1', 'deny'],
  ['i-teamw',    'worker1', 'allow'],   // the author still sees their own incident
  ['i-teamw',    'worker2', 'deny'],
  ['i-assigned', 'worker1', 'allow'], ['i-assigned', 'worker2', 'deny'],
  ['i-assigned', 'owner1',  'allow'], ['i-assigned', 'viewer1', 'deny'],
  ['i-private',  'worker1', 'allow'], ['i-private',  'worker2', 'deny'],
  ['i-private',  'owner1',  'allow'], ['i-private',  'admin1',  'allow'],   // invariant 2
  ['i-team',     'stranger', 'deny'], ['i-circle',   'stranger', 'deny'],
];
for (const [id, uid, expect] of READS)
  await check(`item read ${id} — ${uid}`, getDoc(item(as(uid), id)), expect);

// THE property this phase exists for: a hand-crafted broad query by a
// worker must fail — team/private docs can never ride out in a list
await check('worker cannot list the whole items collection',
  getDocs(collection(as('worker1'), 'households', CIRCLE, 'items')), 'deny');
await check('worker cannot list the whole events collection',
  getDocs(collection(as('worker1'), 'households', CIRCLE, 'events')), 'deny');
await check('viewer cannot list the whole items collection',
  getDocs(collection(as('viewer1'), 'households', CIRCLE, 'items')), 'deny');
// …and the prover accepts queries whose filters GUARANTEE the rule branch —
// these are the exact query shapes the Phase-2 scoped sync will use
await check('worker CAN query circle-wide docs (filtered)',
  getDocs(query(collection(as('worker1'), 'households', CIRCLE, 'items'),
    where('vis', '==', 'circle'))), 'allow');
await check('worker CAN query docs assigned to them',
  getDocs(query(collection(as('worker1'), 'households', CIRCLE, 'items'),
    where('vis', '==', 'assigned'), where('visUids', 'array-contains', 'worker1'))), 'allow');
await check('worker CAN query their own authored docs',
  getDocs(query(collection(as('worker1'), 'households', CIRCLE, 'items'),
    where('authorUid', '==', 'worker1'))), 'allow');
await check('worker canNOT query team docs even filtered',
  getDocs(query(collection(as('worker1'), 'households', CIRCLE, 'items'),
    where('vis', '==', 'team'))), 'deny');
await check('owner CAN list everything (invariant 2)',
  getDocs(collection(as('owner1'), 'households', CIRCLE, 'items')), 'allow');
await check('co-admin CAN list everything',
  getDocs(collection(as('admin1'), 'households', CIRCLE, 'items')), 'allow');

const ev = (db, id) => doc(db, 'households', CIRCLE, 'events', id);
await check('incident (team event) hidden from other workers', getDoc(ev(as('worker2'), 'e-team')), 'deny');
await check('incident visible to co-admin', getDoc(ev(as('admin1'), 'e-team')), 'allow');
await check('incident visible to its author', getDoc(ev(as('worker1'), 'e-team')), 'allow');
await check('open note visible to viewer', getDoc(ev(as('viewer1'), 'e-open')), 'allow');
await check('team receipt hidden from worker',
  getDoc(doc(as('worker1'), 'households', CIRCLE, 'receipts', 'r-team')), 'deny');
await check('team receipt visible to owner',
  getDoc(doc(as('owner1'), 'households', CIRCLE, 'receipts', 'r-team')), 'allow');

// ---------- household doc: membership & role edits ----------
await check('circle rename — co-admin', updateDoc(doc(as('admin1'), 'households', CIRCLE), { name: 'New' }), 'allow');
await check('circle rename — worker DENIED', updateDoc(doc(as('worker1'), 'households', CIRCLE), { name: 'X' }), 'deny');
await check('circle rename — viewer DENIED', updateDoc(doc(as('viewer1'), 'households', CIRCLE), { name: 'X' }), 'deny');
await check('worker cannot self-promote', updateDoc(doc(as('worker1'), 'households', CIRCLE),
  { 'members.worker1': { name: 'Sam', role: 'co-admin' } }), 'deny');
await check('owner changes a role', updateDoc(doc(as('owner1'), 'households', CIRCLE),
  { 'members.worker2': { name: 'Kim', role: 'co-admin' } }), 'allow');
await check('join circle as worker (self-add only)', updateDoc(doc(as('newbie'), 'households', CIRCLE),
  { 'members.newbie': { name: 'Nat', role: 'worker' } }), 'allow');
await check('join circle as viewer', updateDoc(doc(as('newview'), 'households', CIRCLE),
  { 'members.newview': { name: 'Vic', role: 'viewer' } }), 'allow');
await check('join circle as CO-ADMIN denied (escalation)', updateDoc(doc(as('mallory'), 'households', CIRCLE),
  { 'members.mallory': { name: 'Mal', role: 'co-admin' } }), 'deny');
await check('join circle as OWNER denied (escalation)', updateDoc(doc(as('mallory'), 'households', CIRCLE),
  { 'members.mallory': { name: 'Mal', role: 'owner' } }), 'deny');
await check('join circle with a bare string denied', updateDoc(doc(as('mallory'), 'households', CIRCLE),
  { 'members.mallory': 'Mal' }), 'deny');
await check('joiner cannot touch other keys', updateDoc(doc(as('mallory2'), 'households', CIRCLE),
  { 'members.mallory2': { name: 'M', role: 'worker' }, name: 'Hijacked' }), 'deny');

// ---------- circle creation ----------
await check('create circle as owner', setDoc(doc(as('creator'), 'households', 'hh-new1'),
  { name: 'C', type: 'circle', members: { creator: { name: 'C', role: 'owner' } } }), 'allow');
await check('create circle as co-admin (nominee)', setDoc(doc(as('creator'), 'households', 'hh-new2'),
  { name: 'C', type: 'circle', members: { creator: { name: 'C', role: 'co-admin' } } }), 'allow');
await check('create circle as worker DENIED', setDoc(doc(as('creator'), 'households', 'hh-new3'),
  { name: 'C', type: 'circle', members: { creator: { name: 'C', role: 'worker' } } }), 'deny');
await check('create circle with string member DENIED', setDoc(doc(as('creator'), 'households', 'hh-new4'),
  { name: 'C', type: 'circle', members: { creator: 'C' } }), 'deny');

// ---------- items: writes ----------
await check('worker creates a circle-wide item', setDoc(item(as('worker1'), 'w-new1'),
  { text: 'picked up meds', vis: 'circle', authorUid: 'worker1' }), 'allow');
await check('worker creates an unscoped (legacy) item', setDoc(item(as('worker1'), 'w-new2'),
  { text: 'no vis' }), 'allow');
await check('worker creates a team-scoped item as themself', setDoc(item(as('worker1'), 'w-new3'),
  { text: 'incident detail', vis: 'team', authorUid: 'worker1' }), 'allow');
await check('worker cannot forge authorUid on a scoped item', setDoc(item(as('worker1'), 'w-new4'),
  { text: 'forged', vis: 'private', authorUid: 'admin1' }), 'deny');
await check('viewer cannot create items', setDoc(item(as('viewer1'), 'v-new1'),
  { text: 'nope', vis: 'circle', authorUid: 'viewer1' }), 'deny');
await check('worker updates a doc they can see', updateDoc(item(as('worker1'), 'i-circle'),
  { done: true }), 'allow');
await check('worker cannot update a team doc', updateDoc(item(as('worker1'), 'i-team'),
  { done: true }), 'deny');
await check('worker cannot re-author a scoped doc', updateDoc(item(as('worker1'), 'i-private'),
  { authorUid: 'admin1' }), 'deny');
await check('worker cannot delete a team doc', deleteDoc(item(as('worker1'), 'i-team')), 'deny');
await check('co-admin can delete a team doc', deleteDoc(item(as('admin1'), 'i-team')), 'allow');

// ---------- events: append-only + scoping ----------
await check('worker appends an event', setDoc(ev(as('worker1'), 'e-new'),
  { kind: 'note', text: 'walked to the park', authorUid: 'worker1', ts: 3 }), 'allow');
await check('viewer cannot append events', setDoc(ev(as('viewer1'), 'e-nope'),
  { kind: 'note', text: 'x', authorUid: 'viewer1', ts: 4 }), 'deny');
await check('events cannot be updated — even by the owner',
  updateDoc(ev(as('owner1'), 'e-open'), { text: 'rewritten' }), 'deny');
await check('events cannot be deleted — even by the owner',
  deleteDoc(ev(as('owner1'), 'e-open')), 'deny');

// ---------- receipts ----------
await check('receipts append-only',
  deleteDoc(doc(as('admin1'), 'households', CIRCLE, 'receipts', 'r-team')), 'deny');

// ---------- non-circle spaces: behaviour unchanged ----------
await check('family member reads items', getDoc(doc(as('fam1'), 'households', FAMILY, 'items', 'f-1')), 'allow');
await check('family member writes items', setDoc(doc(as('fam2'), 'households', FAMILY, 'items', 'f-2'),
  { text: 'dishes' }), 'allow');
await check('family member edits the space', updateDoc(doc(as('fam1'), 'households', FAMILY),
  { name: 'Home 2' }), 'allow');
await check('family join via string self-add', updateDoc(doc(as('fam3'), 'households', FAMILY),
  { 'members.fam3': 'Chris' }), 'allow');
await check('family stranger read denied', getDoc(doc(as('nope'), 'households', FAMILY, 'items', 'f-1')), 'deny');
// the app's existing unfiltered onSnapshot listen must keep working for
// every non-circle space (regression guard for ideatodo)
await check('family member CAN list items unfiltered',
  getDocs(collection(as('fam1'), 'households', FAMILY, 'items')), 'allow');

await env.cleanup();
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
