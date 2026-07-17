# Working notes for this repo

## Release process
- The app is the single file `app.html`; bump the version label ("Idea → Todo vNN")
  AND the service-worker cache (`const CACHE = 'idea-todo-vNN'` in `sw.js`) on
  every release, then run the Playwright suites in `tests/` against
  `python3 -m http.server 8906` before pushing to `main`.

## Standing documentation rule
- **`FUNCTIONALITY.md` is a living document.** Whenever a user-facing feature
  ships, changes, or is removed, update FUNCTIONALITY.md in the same commit or
  release — it is circulated externally (cohort-expansion reviews, partners),
  so it must never drift from the shipped product.
- The landing page (`index.html`) documents features for prospective users.
  Before adding NEW feature claims to the landing, query the founder first —
  they curate what is marketed.
- **`MONETIZATION.md` is a living document.** When a feature ships that
  creates or moves a premium lever (caps, quotas, paid surfaces), update the
  lever map in the same release.

## Key context
- Two products, one engine — see ARCHITECTURE.md. `managed-config.js` holds
  the ideatodo operator Firebase config (aiProxy live as of v77);
  `flavors/cooee/` holds the Cooee flavor. Backends deploy via
  Actions → deploy-backend.
- Tests mock `managed-config.js` to `window.MANAGED=null` for self-hosted flows
  and block service workers where route-mocking conflicts with the SW.
