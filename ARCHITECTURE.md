# ARCHITECTURE — one engine, two products

*This contract governs how ideatodo and Cooee coexist in this repository. Every
session (human or AI) enforces it. Source: Cooee build brief v0.2 §0.5, adapted
to this codebase's reality (a single-file PWA with no bundler).*

## The contract

1. **One codebase, one `main`.** All pack code — including the Cooee circle
   pack — lives in `main` behind feature flags once stable. `feat/cooee-circle`
   is a workspace, not a home; no pack code may live permanently on a branch.
   Branches diverge; flags don't. Merge `main → feat/cooee-circle` at least
   weekly while the branch exists.

2. **Products are build-time flavors.** A flavor is config only — never code:
   app name, theme tokens, enabled cohorts, Firebase project, hosting target
   (incl. base path / manifest `start_url` / SW registration path for
   subpath hosting), analytics keys.
   - Flavor **ideatodo**: all consumer cohorts (focus/ADHD, co-parenting,
     caregiving, household), existing branding, existing Firebase project.
   - Flavor **cooee**: `circle` cohort only (plus the solo/focus toolkit for
     the participant's own list), Cooee branding, `cooee-*` Firebase projects
     in `australia-southeast1`.
   The same commit builds both. CI builds and smoke-tests both flavors on
   every merge to `main`.

   **Mechanism in this repo:** there is no bundler. The flavor is a config
   file following the existing `managed-config.js` pattern (`window.FLAVOR`),
   plus a small stamp script (`build-flavor.sh`, to be created) that copies the
   app and landing into a deploy directory with flavor values substituted
   (title, theme accent, manifest fields, SW cache prefix, base path). The
   app reads everything else from `window.FLAVOR` at runtime.

3. **Data never mixes; code always does.** Separate Firebase projects per
   flavor. A fix to capture, structuring, sync, or the trust layer ships to
   both products by definition.

4. **The engine/pack test on every change.** Before building anything,
   classify it:
   - *Engine*: capture, structuring, spaces, sync, attribution, append-only
     history, exports, invites, accessibility primitives — benefits every pack.
   - *Pack*: custody chips, tone check, Plan Review Pack, About Me, session
     brackets — gated to a space type / cohort.
   When a pack needs something plausibly generic (session brackets could serve
   trades or co-parent handovers later), build the primitive in the engine and
   only the surface in the pack. Never bury a generic capability inside
   pack-gated code because it was convenient.

5. **No flavor-conditional logic in engine code.** Engine code may read feature
   flags and cohort config; it may never branch on "is this the Cooee build".
   If you're tempted, the thing you're writing is pack code.

6. **Shared engine backlog.** Engine work is tracked once, benefiting both
   products; pack work is tracked per product. Engine hours are never "stolen"
   from one product by the other.

## Cooee-specific invariants (enforce in code review)

From the build brief §2, plus the founder's clarification on decision-makers:

1. **The participant is the tenant.** A `circle` space has exactly one owner
   role bound to the *participant*. Operating control may legally sit with a
   **substitute decision-maker or POA** — modelled as `nominee-owner` (a
   co-admin acting *for* the participant, recorded as such during guided
   setup, in plain language, changeable later). The record always shows who is
   acting on whose behalf. Never silently default ownership to the account
   that created the space when setup declares someone else the participant.
2. **The participant sees everything about themselves.** No data about the
   participant can be scoped away from the owner role — including when a
   nominee operates the account. Enforced in Firestore security rules, not
   just UI. *(Shipped v78: `firestore.rules` role-scopes circle docs; every
   visibility branch grants the owner/co-admin team; the 80-check emulator
   matrix in `tests/rules/` gates CI via `rules-test.yml`. Any change to
   scoping must extend that matrix first.)*
3. **No surveillance features.** No GPS, no clock-in verification, no
   per-worker timing analytics, no productivity dashboards. If a task seems to
   need one, stop and flag it.
4. **Evidence is a byproduct.** No screen may exist whose only purpose is
   compliance data entry.
5. **Coordination, not advice.** Every export carries: "Participant-owned
   coordination record. Not medical, legal, or NDIS advice."

**Copy red lines:** participant is always the grammatical subject ("your
record", never "their records for you"); no "monitor / keep an eye on / peace
of mind about them" framing; no claimability promises, no "NDIS approved", no
NDIS logo; nothing implying Cooee verifies workers.

**Explicit non-goals (do not build):** rostering, payroll/SCHADS, invoicing,
NDIS portal claiming, budget management, GPS/clock-in, worker analytics,
clinical or behaviour-support content, NDIS Commission submissions.

## Deploy targets

- **ideatodo**: current GitHub Pages (`etheodore15.github.io/todo-list`) →
  Firebase Hosting at cutover (see APPSTORE.md).
- **cooee**: dedicated repo/URL on GitHub Pages first (separate front door;
  a GitHub Pages site is per-repo, so the dedicated URL requires the separate
  repo — code still lives here, CI publishes the cooee flavor there), custom
  domain (`getcooee.com.au` preferred) as DNS-level migration insurance,
  Firebase Hosting later. Pilot backend: separate `cooee-pilot` Firebase
  project in `australia-southeast1`; never pilot on the production project.
