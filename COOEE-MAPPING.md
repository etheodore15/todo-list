# Cooee circle pack — extension-point mapping (Session 1)

*Brief v0.2's assumptions about the codebase, verified against the code as of
v75. Purpose: flag divergences BEFORE writing code. References are to
`app.html` unless noted; line numbers drift — search the named symbol.*

## 1. Extension points the brief assumes — verified

| Brief assumption | Reality in code | Fit |
|---|---|---|
| `COHORTS` registry | `const COHORTS = [...]` (~line 985): `{id, ico, title, desc, features[], actions[]}`. ids are storage keys. Adding `ndis-circle` is one entry | ✅ direct |
| Space types with type-gated action bars | `SPACE_ICON` map + `SPACE_ACTIONS = {coparenting, care, family}` (~2810) rendered by `renderSpaceBar()`. Adding `circle` = new key in both | ✅ direct |
| Guided setup checklists per type | `openSetupSheet(sp)`-style steps array built per `sp.type` (~5730, `#setupSheet`): `{label, desc, fn}` persistent checklist. Circle setup (who-is-this-for, About Me, routines, plan goals, invite) slots in | ✅ direct |
| Runtime-composed structuring prompt | Prompt assembled at call time with member names + tag vocabulary (`geminiSummarize`, ~1510-1520; heuristic parallel in `localSummarize`). Circle additions (roles, session vocab, plan-goal tags) are prompt text keyed off space type | ✅ direct |
| Trust layer is generic | `logEvent()` append-only events with who/ts/kind/tombstones; `auditCsv` + print export; attribution stamps (`doneBy/createdBy/expenseBy`). All space-type-agnostic | ✅ direct |
| Care profile as About Me base | `careProfile` store + `PROFILE_FIELDS` + `openProfile(sp)` / profile card on Today. About Me = extended field set + "first card a new worker sees" surface | ✅ extend |
| Doctor-briefing pattern for Plan Review Pack | v66 report framework: `openReport(title, loading, compose)` overlay, per-cohort composers, print/PDF path, AI + local fallback (`geminiBriefing`/`localBriefing`). Plan Review Pack = a new composer + template | ✅ direct |
| Handoff surfaces reusable | `renderCareHandoff()` ("since your last visit") + missed-dose banner keyed to `care` type today; parameterise by space type for `circle` | ✅ small change |
| Expense CSV | Ledger + receipts exist (`syncReceipt`, `ledgerBalances`, CSV). Needs added columns: support date, ABN/provider free-text, receipt ref | ✅ extend |

## 2. Genuinely new — no engine primitive exists (the real work)

1. **Roles.** Membership today is a flat name list (`spaceMembers` map, synced
   member names). There is no role concept anywhere. Circle needs
   `owner / co-admin / worker / viewer` on membership — an **engine primitive**
   (roles on space membership) with pack-level meaning.
   - **Founder clarification (binding):** the participant is the tenant, but a
     **substitute decision-maker / POA** may hold operating control — model as
     `nominee-owner` (co-admin acting for the participant, recorded as such,
     plain-language setup, changeable later, every change logged).
2. **Per-item scoped visibility.** Today's scope model is
   `private (device) / space-wide / assignees` enforced **client-side**
   (`visibleToMe()`, ~1173). Circle needs `circle / team / assigned / private`
   **enforced in Firestore security rules** — a worker token must not be able
   to read `team`-scoped docs with a hand-crafted query. Current managed rules
   (`firestore.rules`) gate by space membership only — `members[uid]` maps
   UID → display name, no role. (That map is the natural home for a role
   value: `members[uid] = {name, role}` with a migration path for string
   values.)
   - Deliverable: rules + `@firebase/rules-unit-testing` matrix
     (role × scope × CRUD). **Phase gate: no Phase 2 until green.**
   - Note: journal entries *about the participant* are always owner-visible
     (invariant 2); a worker's personal to-dos live in their own solo space and
     are out of scope entirely.
3. **Role-carrying invites.** `inviteEncode/inviteDecode` (~4533): ITODO1/2
   codes carry `{hid, name, type}` (+ keys for self-hosted) — **no role, no
   expiry, no rate limit, reusable**. Circle invites need: role field
   (default `worker`), single-use-or-expiring codes, server-side redemption
   rate-limiting (Phase 5 pen-pass item). Role changes = owner/co-admin
   action, logged.
4. **Session brackets.** No session record type exists. New event/record kind
   `{workerId, start, end}`; ticks/notes inside the window attach; renders as
   a session card in history and handoff. Auto-close after 12h with an
   "ended automatically" marker. Build the *record primitive* in the engine
   (generic "bracket"), the "Starting/Ending support" surface in the pack.
   Explicitly NOT time-tracking — no per-worker duration totals anywhere.
5. **Incident note subtype.** Notes exist (`kind:'note'` events + Ideas
   copies); no subtypes, no structured fields, no non-deletable flag beyond
   the append-only record itself. Incident = structured note
   (what/when/who-present/action-taken), voice-fillable, always owner+co-admin
   visible regardless of author, tombstone-only deletion, surfaced in history
   and the Plan Review Pack. UI copy: "A record for your circle — this does
   not notify the NDIS Commission or anyone outside this space."
6. **Plan-goal tags.** Tags exist and the picker (v74) is checkbox-based, but
   tags have no type. Plan goals = tags with `type: planGoal`, fed to the
   structuring prompt, grouping progress notes in the Plan Review Pack.
7. **Consent & visibility screen.** No equivalent exists. New owner/co-admin
   screen: who's in the circle, role, what each role sees, per-category
   toggles (e.g. workers-see-expenses on/off), every change logged.

## 3. Divergences from the brief's assumptions

1. **No bundler → flavors are config + stamp script**, not build-time env in
   the webpack sense. See ARCHITECTURE.md §2 mechanism. The brief's
   PWA-subpath gotchas (manifest `start_url`/`scope`, SW path) become flavor
   config values consumed by the stamp script.
2. **A branch cannot have its own GitHub Pages URL** (Pages is per-repo).
   Dedicated Cooee URL = dedicated repo that CI publishes the cooee flavor
   into; development stays on `feat/cooee-circle` here. Founder is creating
   the repo and granting access.
3. **The managed backend is not yet live** (AI proxy undeployed; production
   cutover pending — APPSTORE.md Track A). Circle's rules work targets the
   new `cooee-pilot` Firebase project and can proceed independently, but
   end-to-end managed testing needs that project created
   (`australia-southeast1`) — founder action.
4. **Anonymous-first auth + role-bound rules:** rules that bind roles to
   Firebase Auth UIDs require members to have stable UIDs. Current invites
   join spaces without accounts (anonymous auth in managed mode — fine, UIDs
   exist). Self-hosted ITODO1 spaces (raw API keys, no auth) **cannot enforce
   role scoping** — circle spaces must be managed-only. Enforce at creation.
5. **`visibleToMe()` stays** as the UX layer for circle scopes, but is not the
   security boundary — rules are. Both must implement the same matrix; the
   rules tests are the source of truth.

## 4. Founder-side prerequisites (tracked, not blocking early phases)

- [ ] Trademark screen (IP Australia TM Checker cl. 9/42), ASIC name search,
      domain check before any public "Cooee" use. Fallbacks: Banksia, Relay.
- [ ] `getcooee.com.au` purchase (needs ABN) — the URL-migration insurance.
- [ ] Dedicated GitHub repo/org for the Cooee front door (in progress) +
      access grant for CI publishing.
- [ ] `cooee-pilot` Firebase project, `australia-southeast1` (Firestore,
      Auth, Storage), before any real circle exists (Phase 5 gate).
- [ ] Pilot consent doc (plain language) — Phase 5 item 5.

## 5. Build order (per brief §9, adjusted)

1. ~~Session 1: this mapping + ARCHITECTURE.md~~ ✅
2. Session 2: flavor config + stamp script + CI both-flavors build; Phase 1a
   cohort entry + 1b `circle` space type & guided setup (behind feature flag)
3. ~~Sessions 3–4: Phase 1c roles + Firestore rules + rules test matrix
   (gate)~~ ✅ v78 — `firestore.rules` role-scopes circle docs
   (owner/co-admin/worker/viewer × circle/team/assigned/private); the
   80-check emulator matrix in `tests/rules/` is the phase gate (CI:
   `rules-test.yml`). Client: circle invites carry a clamped worker/viewer
   role; joins/creates write `members[uid] = {name, role}`.
   **Discovery that shapes Phase 2:** for `list`, the rules prover binds
   `resource.data` to the query's equality constraints — a negative branch
   like `!('vis' in resource.data)` waves *unfiltered* queries through.
   So `allow list` uses positive-field branches only (`canListDoc`), and
   worker/viewer clients MUST sync circles with the proven filtered query
   shapes: `where('vis','==','circle')`, `where('vis','==','assigned') +
   array-contains visUids`, `where('authorUid','==',uid)`. Owner/co-admin
   (and non-circle spaces) keep the existing unfiltered onSnapshot.
4. Session 5: Phase 1d prompt + Phase 2 worker flows (brackets, handoff,
   incident capture) + the scoped-sync merge described above
5. Session 6: Phase 3 plan goals + Plan Review Pack + expense export columns
6. Session 7: Phase 4 About Me / accessibility / consent screen; Phase 5
   hardening checklist
7. Session 8: Cooee landing page + Pages deploy workflow to the dedicated
   repo + custom-domain wiring
