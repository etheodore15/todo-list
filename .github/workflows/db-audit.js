// Read-only allocation audit for the managed Firestore backend.
// Prints counts and truncated identifiers only — no user content (the
// Actions log is public). Run by .github/workflows/db-audit.yml.
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.PROJECT,
});
const db = admin.firestore();

const short = (s, n) => (s == null ? '(none)' : String(s).slice(0, n));

(async () => {
  const hhs = await db.collection('households').get();
  console.log(`\n=== ${process.env.PROJECT}: ${hhs.size} household doc(s) ===\n`);

  let totalItems = 0, totalEvents = 0, totalMismatch = 0;
  for (const hh of hhs.docs) {
    const d = hh.data();
    const [items, events, receipts] = await Promise.all([
      hh.ref.collection('items').get(),
      hh.ref.collection('events').get(),
      hh.ref.collection('receipts').get(),
    ]);
    const kinds = {};
    let lastTs = d.created || 0;
    events.forEach((e) => {
      const ev = e.data();
      kinds[ev.kind || '?'] = (kinds[ev.kind || '?'] || 0) + 1;
      if ((ev.ts || 0) > lastTs) lastTs = ev.ts;
      if (ev.space && ev.space !== hh.id) totalMismatch++;
    });
    // an item stored under this household but stamped for another space is
    // exactly the misallocation the audit is hunting for
    const badItems = items.docs.filter((i) => (i.data().space || null) !== hh.id);
    totalItems += items.size; totalEvents += events.size; totalMismatch += badItems.length;

    console.log(JSON.stringify({
      hid: short(hh.id, 12) + '…',
      name: short(d.name, 12),
      type: d.type || '(unset)',
      members: d.members ? Object.keys(d.members).length : 0,
      created: d.created ? new Date(d.created).toISOString().slice(0, 10) : null,
      items: items.size,
      itemsWithWrongSpaceField: badItems.length,
      receipts: receipts.size,
      events: events.size,
      eventKinds: kinds,
      lastActivity: lastTs ? new Date(lastTs).toISOString() : null,
    }));
  }

  const cohorts = await db.collection('cohorts').get();
  const byCohort = {};
  cohorts.forEach((c) => {
    (c.data().cohorts || [c.data().cohort || '?']).forEach((k) => {
      byCohort[k] = (byCohort[k] || 0) + 1;
    });
  });
  const users = await db.collection('users').get();

  console.log('\n=== totals ===');
  console.log(JSON.stringify({
    households: hhs.size,
    items: totalItems,
    events: totalEvents,
    crossSpaceMismatches: totalMismatch,
    userDocs: users.size,
    cohortDocs: cohorts.size,
    byCohort,
  }));
  console.log('\nNote: items/notes saved to "Private" never sync — they exist only in');
  console.log('localStorage on the device that created them and cannot appear here.');
})().catch((e) => { console.error(e); process.exit(1); });
