# Roadmap: ADHD/Neurodivergent · Co-parenting · Caregiving

The engine we have — voice capture → on-device transcription → AI structuring →
scoped/delegated sync with attribution — is worth more to these three audiences
than to general families. This roadmap turns it into products they'd pay for.

**Why these audiences:** pain is concentrated (they *need* coordination, not
nice-to-have), willingness to pay is proven (OurFamilyWizard charges $100+/yr
per co-parent), and our existing primitives (transcripts, attribution
timestamps, delegation, per-person visibility) are 80% of their hard parts.

---

## Phase A — Foundation (everything below depends on these)

These are gaps for *any* serious todo product; each unlocks multiple
audience features.

| # | Feature | Notes |
|---|---------|-------|
| A1 ✅ v24 | **Edit task text** (tap-and-hold or ✏️ in expansion) | Table stakes; syncs like any change |
| A2 ✅ v24 | **Future dates** — tasks scheduled beyond today; "Today / Upcoming" split; AI extracts dates ("book dentist for the 14th") | Currently everything lands on today. Prereq for schedules, appointments, custody days |
| A3 ✅ v24 | **Recurrence** — "bins every Tuesday", "meds every morning"; AI + heuristic parse `recur` rules; on rollover, spawn next instance | THE caregiving/ADHD staple. Store rule on task; daily rollover engine already exists |
| A4 ◐ v24 | **Reminders (honest version)** — extend the daily digest to N checks/day with "due soon" items; in-app "due now" highlights | Digest now includes a due-tomorrow count; per-day check frequency is browser-controlled (Periodic Background Sync), so more granularity waits for the TWA wrapper |
| A5 ✅ v24 | **Undo** — toast with undo after tick/delete | ADHD misfires are common; forgiveness is a feature |
| A6 ✅ v27 | **Multiple spaces** — belong to more than one household (e.g. "Home" + "Mum's care" + "Co-parenting"), with a space switcher | Spaces carry a name and a `type` (family/coparenting/care); tasks keyed per space + a Personal lane; migration from the single-household model. Per-space member lists still TODO (currently one global list) |

---

## Phase B — ADHD / Neurodivergent pack ("the brain-friendly mode")

Design principle: reduce shame, reduce overwhelm, lower activation energy.
The voice brain-dump we already have is the #1 ADHD feature; these amplify it.

| # | Feature | Why it matters |
|---|---------|----------------|
| B1 ✅ v25 | **Break it down** — button on any task: AI splits it into 3–7 tiny first-step-obvious subtasks ("clean the kitchen" → "put 5 things in the dishwasher", …) | Task initiation is *the* ADHD blocker. Gemini does this superbly; subtasks nest under the parent with their own ticks |
| B2 ✅ v25 | **Just One Thing mode** — full-screen single task view: the one next thing, huge tick button, "not this one" shuffle | Overwhelm kills lists. Choosing is hard; the app chooses |
| B3 ✅ v26 | **Energy levels** — tasks auto-tagged 🔋 low / 🔋🔋 medium / 🔋🔋🔋 high effort (AI + heuristic); "I've got 10 minutes and no energy" filter | Matching tasks to capacity beats priority when executive function is low |
| B4 ✅ v26 | **No-shame carry-over** — tasks never go red or say "overdue"; a task carried 5 days quietly offers: "still matters? → today / someday / let it go" | Guilt spirals cause app abandonment; this is why ADHD users quit Todoist |
| B5 ✅ v26 | **Wins view** — "Done today/this week" list with gentle celebration; streaks count *any* activity, never break loudly | Dopamine needs closing loops, not punishment mechanics |
| B6 ✅ v26 | **Time-blindness aids** — AI estimates duration per task ("~15 min"); day view shows total load vs realistic capacity warning | "I'll do all 12 today" is time blindness; surfacing load helps |
| B7 ✅ v26 | **Focus/quiet visual mode** — reduced-motion, reduced-clutter theme toggle | Sensory load matters; cheap to do with CSS |

**Phase B shipped** (v25–v26): the ADHD pack is live and ready to validate
in ADHD communities. Next up: C1, whose spine (spaces ✅, audit log, exports)
is now unblocked by A6.

---

## Phase C1 — Co-parenting pack ("the record keeper")

Design principle: everything provable, nothing deletable, temperature lowered.
Our attribution timestamps are already the seed of an evidence trail.

| # | Feature | Why it matters |
|---|---------|----------------|
| C1a | **Audit log** — append-only event stream per space (created/edited/ticked/deleted, by whom, when, with prior values). Deletes become tombstones in the log even though the list tidies | The core promise: neither parent can rewrite history. Firestore append-only subcollection |
| C1b | **Export for records** — one tap: date-ranged PDF (print stylesheet) / CSV of the audit log and task history | "For your lawyer/mediator" is the killer feature OurFamilyWizard charges for |
| C1c | **Tone check** — before a task/note syncs to the co-parent space, Gemini flags hostile phrasing and suggests a neutral rewrite ("Tell your father he's late again" → "Pickup was 25 min after the agreed time") | ToneMeter is OurFamilyWizard's most-cited feature; trivial for our Gemini pipeline |
| C1d | **Expenses lite** — a task can carry an amount + photo of receipt; running ledger per space with "owed" split and CSV export | Money is the #2 co-parenting conflict; photos via camera input, stored as Firestore-linked images (needs Storage or base64-thumbnails — size limits to respect) |
| C1e | **Custody-aware days** — mark repeating "their days/my days"; delegation defaults and digest adapt ("handover tomorrow: 3 items") | Builds on A2/A3 recurrence |

**Effort:** C1a/C1b ~2 sessions; C1c ~half (prompt + intercept); C1d medium
(storage decisions); C1e after A2/A3. **Requires Phase A6 (spaces)** so a
co-parent space can have exactly two members and stricter rules.

---

## Phase C2 — Caregiving pack ("the care team")

Design principle: many hands, one picture; the person being cared for is a
subject, not a user.

| # | Feature | Why it matters |
|---|---------|----------------|
| C2a | **Care recipient profile** — a space "about Mum": tasks/notes attach to her, members are the care team (siblings, carers) | Reuses spaces (A6) + members; recipient isn't a device holder |
| C2b | **Routines & meds** — recurring timed tasks ("Ramipril 8am daily") with tick attribution = a de-facto medication administration record; missed-dose visibility in the digest | Rides A3 recurrence + existing attribution. The audit log (C1a) makes it trustworthy |
| C2c | **Care notes** — voice-captured observations ("she seemed dizzy this morning") shared to the care space as a journal (opt-in per note — extends the ideas-stay-private rule with a "share to space" action) | Handover between siblings/carers is the daily pain; voice capture shines here |
| C2d | **Doctor visit briefing** — button: Gemini summarizes the last N weeks of notes + med adherence + open concerns into a one-page printable brief | Turns scattered notes into the thing you actually bring to the GP; unique and demo-able |
| C2e | **Shift handoff digest** — "what happened since you were last on" per member | Extends the existing family-activity banner + digest machinery |

**Effort:** C2a rides A6; C2b rides A3+C1a; C2c ~1 session; C2d ~1 session;
C2e small. Caregiving reuses co-parenting's audit spine almost entirely.

---

## Sequencing & strategy

```
A (foundation) ──→ B (ADHD pack) ──→ ship & validate in ADHD communities
        │
        └──→ A6 spaces ──→ C1 co-parenting ──→ C2 caregiving
                              (shared audit/export spine)
```

1. **Build B first.** It needs the least new architecture, the audience is
   reachable (ADHD forums/TikTok), the free self-hosted version is fine for
   validation, and every B feature also helps the other two audiences.
2. **C1 and C2 share a spine** (spaces, audit log, exports) — build once,
   skin twice.
3. **Monetization mapping:** B = consumer subscription ($4–6/mo, "brain-friendly
   capture"); C1 = premium per-parent ($8–12/mo, records + tone + expenses);
   C2 = per-care-team ($6–10/mo). C1/C2 justify the hosted-backend
   productization work; B can validate before it.
4. **Trust obligations grow with C:** co-parenting/caregiving data is
   sensitive and quasi-legal. Before charging for C1/C2: hosted backend with
   real auth and per-space rules, retention policy, export guarantees, and a
   clear "not legal advice / not a medical device" line. B carries none of
   that weight — another reason it goes first.

## Architecture decision: space types, not forks

One repo, one deployed app. The audiences are served by a `type` on each
space (A6) — `family`, `coparenting`, `care` — which switches on the relevant
pack: co-parenting spaces get the audit log / tone check / exports, care
spaces get meds and handoffs, and the ADHD "brain-friendly mode" is a
personal setting independent of any space. Rationale:

- Every hard-won fix (speech quirks, Gemini discovery, sync engine) ships
  once instead of being ported across four drifting branches.
- C1 and C2 share ~80% of their spine; B features help all audiences.
  Forks throw that leverage away.
- Real users cross audiences (an ADHD co-parent coordinating care for a
  parent) — one install, several spaces.
- If a niche takes off commercially, differentiate with build-time branding
  config (name/icon/theme/default space type) from the same history — the
  standard white-label pattern — never with divergent code.

Git branches remain for development (feature branches merging to `main`),
not product lines.

## Honest limitations to design around

- **Timed reminders:** PWAs can't reliably fire minute-exact alarms; the daily
  digest + in-app cues are the ceiling until a Play Store (TWA) wrapper. Med
  schedules must therefore show *adherence*, not promise *alarms* (pair with
  phone's native alarm for actual dosing times).
- **Evidence-grade claims:** our audit log is honest and tamper-evident at the
  app level, but with client-side keys a motivated party could write to
  Firestore directly. True court-grade integrity needs the hosted backend
  (server timestamps, rules that forbid edits). Ship C1 as "records", upgrade
  to "evidence" only after productization.
- **Medical:** C2 is coordination, not clinical. No dosing advice, no health
  claims, ever.
