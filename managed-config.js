// Managed ("hosted service") configuration.
//
// When null, the app runs fully self-hosted: every household brings its own
// Firebase project (Settings → Spaces → self-hosted setup).
//
// To ship the app "ready to use" (no user configuration at all), the operator
// creates ONE Firebase project for everyone and pastes its web config here —
// see OPERATORS.md for the 15-minute runbook. Firebase web configs are public
// identifiers, not secrets: access control lives in firestore.rules, which
// requires sign-in and per-space membership.
window.MANAGED = null;
// Example (operator fills in):
// window.MANAGED = {
//   apiKey: 'AIza…',
//   authDomain: 'your-project.firebaseapp.com',
//   projectId: 'your-project',
//   appId: '1:1234567890:web:abc123'
// };
