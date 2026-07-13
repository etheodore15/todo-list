# User flows & architecture notes

A map of how the app works, for account management and onboarding new
contributors. Pairs with `ROADMAP.md` (what's built and planned),
`OPERATORS.md` / `functions/README.md` (running the managed service), and the
in-app version label (bottom of Settings).

## The one-screen mental model

Everything is one static PWA (`index.html` + `sw.js` + `digest.js` + vendored
libraries). No build step. State lives in the browser (`localStorage`); shared
lists sync through Firestore. AI is optional and pluggable (built-in heuristic
→ operator proxy → the user's own key).

## Core flows

### 1. Capture → tasks

1. **Capture** tab → speak (Web Speech, or offline Whisper) or type.
2. **Summarize & Add** → AI (proxy / key) or the built-in heuristic turns the
   text into a summary + structured tasks (priority, tags, date, time, recur,
   energy, assignees).
3. Tasks land on **Today**; the idea + transcript stays private on the device.

### 2. Today

Grouped **Do first / Do today / If time allows**, plus **📅 Upcoming**,
**🌙 Someday**, **🏆 Wins**. Chips per task: scope, date, time, recur, energy,
amount. Filters: space, tag, 🔋 easy-wins. **🎯 Just one thing** for focus.

### 3. Spaces (shared lists)

- A **space** has a `type` (family / coparenting / care) that switches on its
  pack. You can belong to several; a switcher filters Today, plus a 🔒 Personal
  lane that never syncs.
- **Managed mode** (operator project baked into `managed-config.js`): create a
  space in one tap; invites are keyless `ITODO2` codes; access is enforced by
  Firestore rules membership. **Self-hosted mode**: each household brings its
  own Firebase project; `ITODO1` invites carry the config.
- Per-space shared settings (custody, care profile, members) live on the
  household doc; append-only `items` / `events` / `receipts` subcollections
  carry tasks, history, and expenses.

### 4. The audience packs

- **ADHD/focus** (personal): break-it-down, focus mode, energy, no-shame
  carry-over, wins, quiet mode.
- **Co-parenting** (space): audit history + export, tone check, expenses +
  ledger, custody days.
- **Caregiving** (space): care profile, meds/routines + adherence, care
  journal, doctor briefing, shift handoff.

### 5. First run & cohorts

First launch → "What brings you here?" → multi-select cohorts → tailored
toolkit. Stored locally and (managed mode) on `cohorts/{uid}`. Revisit from
Settings.

## Data model (localStorage → Firestore)

| Local key | Synced? | Notes |
|---|---|---|
| `todos` | per-space `items/{id}` | the task list; `space:null` = personal, never syncs |
| `ideas` | no | captures + transcripts stay on-device |
| `events` | per-space `events/{id}` | append-only audit history |
| `pendingRc` → receipts | per-space `receipts/{id}` | expense ledger (compressed thumbnails) |
| `custody` / `careProfile` / `spaceMembers` | household doc fields | shared per-space settings |
| `cohorts` | `cohorts/{uid}` | cohort + first-party usage counters (managed only) |

## Analytics (first-party, privacy-safe)

`track(event, props)` writes anonymized counters — `opens`, `onboards`,
`spacesCreated`, `aiCalls`, `featureUses`, per-feature and per-space-type
tallies, `cohorts`, `lastSeen` — to the user's **own** `cohorts/{uid}` doc, and
only when a managed backend exists. It never records task/idea content, names,
or amounts. The operator dashboard aggregates these. GA4 is not used by
default; if added later it must be consent-gated and carry only the same
anonymized signals.

## Where the backend lives (IaC)

- `firestore.rules` — access control (membership, append-only, operator
  allowlist).
- `functions/` — the AI proxy (holds the operator Gemini key, per-user quota).
- `firebase.json` + `.firebaserc` + `deploy-backend.sh` — one-command deploy.
- Front-end ships via GitHub Pages on `git push` to main.

## Release loop

Edit → run the Playwright suites in `tests/` against a local server → bump the
version label in `index.html` and the `CACHE` in `sw.js` → commit → push →
GitHub Pages deploys. Every feature has a `test_vNN_*.js` suite.
