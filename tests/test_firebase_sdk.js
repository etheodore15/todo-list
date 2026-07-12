const { chromium } = require('playwright');
// Verify the real vendored Firebase SDK loads and exports every function we call.
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8906/', { waitUntil: 'networkidle' });
  const r = await page.evaluate(async () => {
    try {
      const app = await import('./vendor/firebase-app.js');
      const fs = await import('./vendor/firebase-firestore.js');
      const needApp = ['initializeApp'];
      const needFs = ['initializeFirestore', 'persistentLocalCache', 'collection', 'doc', 'setDoc', 'deleteDoc', 'onSnapshot'];
      const missing = [...needApp.filter(n => typeof app[n] !== 'function'),
                       ...needFs.filter(n => typeof fs[n] !== 'function')];
      if (missing.length) return { error: 'missing exports: ' + missing.join(', ') };
      // construct against a dummy project — no network happens until first op
      const a = app.initializeApp({ apiKey: 'x', projectId: 'dummy-project' });
      const db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache() });
      const col = fs.collection(db, 'households', 'h1', 'items');
      const d = fs.doc(db, 'households', 'h1', 'items', 't1');
      return { ok: true, colType: col.type, docType: d.type };
    } catch (e) { return { error: e.message }; }
  });
  console.log(JSON.stringify(r));
  console.log(r.ok ? 'PASS: real SDK loads, all APIs present' : 'FAIL');
  await browser.close();
  process.exit(r.ok ? 0 : 1);
})();
