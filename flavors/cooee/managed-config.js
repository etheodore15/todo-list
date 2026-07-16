// Cooee flavor — managed (hosted-service) configuration + flavor identity.
// Stamped into the deploy by build-flavor.sh; see ARCHITECTURE.md.
//
// Firebase web configs are PUBLIC identifiers, not secrets: access control
// lives in firestore.rules (Phase 1c: role-scoped rules are the deliverable).
// Project: cooee-dbde6 — Firestore/Auth/Storage in australia-southeast1.
window.MANAGED = {
  apiKey: 'AIzaSyDNM7X2ULqfaAjOWtWDgR_gtRdzOb7JA_4',
  authDomain: 'cooee-dbde6.firebaseapp.com',
  projectId: 'cooee-dbde6',
  storageBucket: 'cooee-dbde6.firebasestorage.app',
  appId: '1:412085245732:web:62ae1caf21ae35202d85b1',
  appUrl: 'https://etheodore15.github.io/cooee/app/',
  // Operator AI proxy (Sydney) — the Gemini key lives in Secret Manager behind
  // this function, never in any client. Until the function is deployed
  // (Actions → deploy-backend), calls fail fast and the built-in heuristic
  // carries structuring, same as before.
  aiProxy: 'https://australia-southeast1-cooee-dbde6.cloudfunctions.net/ai'
};

window.FLAVOR = {
  id: 'cooee',
  name: 'Cooee',
  shortName: 'Cooee',
  // circle first; the focus toolkit serves the participant's own list
  cohorts: ['ndis-circle', 'adhd'],
  flags: {circle: true},
  // interim palette: warm eucalypt green (final brand at the landing pass)
  theme: {
    accent: '#0f7b6c',
    accent2: '#0a6157',
    'accent-deep': '#0a5f54',
    'accent-subtle': 'rgba(15,123,108,.10)',
    'accent-subtle2': 'rgba(15,123,108,.16)'
  }
};
