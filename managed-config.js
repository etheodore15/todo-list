// Managed ("hosted service") configuration.
//
// When null, the app runs fully self-hosted: every household brings its own
// Firebase project (Settings → Spaces → self-hosted setup).
//
// These are the operator's Firebase project identifiers. Firebase web configs
// are PUBLIC identifiers, not secrets: access control lives in firestore.rules,
// which requires sign-in and per-space membership. See OPERATORS.md.
window.MANAGED = {
  apiKey: 'AIzaSyDOtAvnrWCQfYN-tjnzPmp9RbrXjbz5zI0',
  authDomain: 'todo-list-50050.firebaseapp.com',
  projectId: 'todo-list-50050',
  appId: '1:913426523006:web:692d78760ab0fecb15c92f'
  // Optional, add later:
  // aiProxy: 'https://us-central1-todo-list-50050.cloudfunctions.net/ai',  // P2 shared AI
  // gaId: 'G-L3GM4LZY5H',   // consented GA4 opt-in (measurementId from the console)
  // appUrl: 'https://…/'    // only when you move off GitHub Pages / add a custom domain
};
