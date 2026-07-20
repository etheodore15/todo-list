# Idea → Todo — full functionality summary & user flows

*Prepared as a self-contained brief for review. The purpose of the review: identify
other communities or cohorts this application could serve, and what adapting it
to them would require. Everything below describes working software unless marked
otherwise. Landing page: https://etheodore15.github.io/todo-list/*

*This is a **living document** — it is amended with every release so it never
drifts from the shipped product. Last updated: **v96**. Recent arc (v84–v96):
a 44-persona study (executable simulations across ADHD, family, co-parenting,
care, NDIS-circle and edge audiences — see `Market-Research/personas/`) drove
eleven releases closing its top findings: capture that understands the care
register of speech, one task per medication dose, a PRN safety line, spoken
dollar amounts landing in the ledger, N-way money with configurable splits,
fortnightly/quarterly/sub-daily recurrence, term-and-holiday custody with
third caregivers, numeric readings trended in the doctor briefing, space
archive/close with export-and-purge, photo capture with text recognition,
and a private journal. Each finding was re-verified against the persona that
surfaced it. v95 added joiner onboarding (every invite arrival gets a
30-second welcome shaped by the space and role being joined); v96 added
AI-fallback transparency and a Developer functions section in Settings.*

> **Caveat:** the product is in active development. Some features are new and
> may behave unpredictably. The operator AI proxy is live in production —
> Smart AI works out of the box with a per-user daily quota, falling back to
> the built-in heuristic only when a call fails (and, since v96, saying why).

---

## 1. What it is

An installable web app (PWA) that turns **spoken, messy intentions into
structured, shared, delegated to-do lists**. One capture-and-structure engine
serves several audiences through "packs" — feature bundles keyed to the kind of
coordination load the user carries. Current packs: **focus & follow-through
(ADHD / executive function)**, **co-parenting**, **family caregiving**, and
**general households**. In-product labels are functional-first ("Focus &
follow-through" — describing the struggle, not a condition) so no one has to
identify with a label to pick the toolkit; external-facing copy may still say
ADHD where people search for it.

The product thesis: the hard part of every to-do tool is getting a real human
intention out of someone's head and into a form others can act on and trust.
Voice-first capture + AI structuring + shared spaces with an append-only record
solves that once; each new cohort is mostly a new surface on the same engine.

## 2. The core engine

**Capture → Structure → Share.**

1. **Capture** — tap the mic and brain-dump. Voice works out of the box on
   every device, no download: live transcription (words appear as you speak)
   via the browser speech engine where it exists (Android/desktop Chrome),
   and elsewhere (iOS Safari, Firefox) recordings transcribe in near-real-time
   5-second segments through the operator AI proxy. A fully private on-device
   Whisper model remains as an opt-in download (nothing leaves the phone;
   works offline). Typing works everywhere. A one-line "quick add" exists for
   pre-formed tasks. An **"Add to" destination row** on the capture screen
   (Private + every space the user belongs to) shows — and lets the user
   change — where the capture will land before saving; the pick sticks for
   subsequent captures. Task creation is always the primary action; when the
   destination is a care space, a secondary "Save to journal" button is
   offered alongside it.
2. **Structure** — the transcript is processed in the background (the user
   keeps talking; a toast/system notification announces when tasks are live and
   where they landed). Extraction produces, per task: text that keeps concrete
   specifics (places, events, names), due date, time of day (handles spoken
   forms — "nine AM", "half past", "by twelve"), recurrence ("every Tuesday",
   "1st of the month"), priority (urgency × importance; medications rank high),
   1–3 sorting tags from a stable vocabulary, delegation assignees ("remind
   Lulu to…"), an effort/energy rating and a minutes estimate. Observations and
   feelings are kept as notes, never turned into fake to-dos; past-tense
   narration ("I already paid it") is filtered out. Two engines: a cloud LLM
   (Gemini; via each user's own key today, via an operator proxy with per-user
   quotas when deployed) and a surprisingly capable built-in heuristic fallback
   that works offline.
3. **Share** — tasks live in **spaces**: a household, a co-parenting pair, a
   care team. Real-time sync (Firestore) to every member's phone, offline-first
   with reconciliation. Invites are a single paste-code; joining requires no
   account setup. Tasks can be private, space-wide, or assigned to named people
   who each see what's theirs.

## 3. Feature inventory

### Task management (all cohorts)
- Today view with priority bands (Do first / Do today / Soon), progress bar,
  and time-remaining estimate ("~40m of doing left")
- **Break it down**: any daunting task becomes 3–7 tiny first steps (AI, with a
  task-aware fallback — outings get leave-by-alarm logistics steps anchored to
  the task's own time; getting-ready tasks get lay-out-clothes steps)
- Date/time/recurrence editing via native pickers; future tasks in an Upcoming
  section; "Someday" parking
- **No-shame carry-over**: unfinished tasks never go red; after 5 quiet days the
  app gently asks "still matters?" (keep / someday / let it go)
- **Energy matching**: tasks rated low/medium/high effort with minute
  estimates; an "easy wins" filter surfaces low-effort items
- **Just One Thing**: a full-screen single-task focus mode for overwhelm
- **Wins view**: what got finished today/this week; streak counts activity and
  never punishes gaps
- Tags with counts and filtering; per-person filter chips. Tags are edited
  with a tick-up-to-3 checkbox picker over the known vocabulary (typing only
  to coin a new tag) — no comma-separated text entry
- **Quiet visual mode**: a calmer, lower-stimulus theme
- Undo on destructive actions; edit-in-place for text, dates, tags, scope
- **Real-life recurrence** (v90): beyond daily/weekly/monthly — fortnightly
  ("every second Thursday" — FIFO swings, pay cycles, injections),
  month-multiples ("every three months", "quarterly"), and sub-daily
  ("every three hours" — newborn feeds: ticking respawns the next slot N
  hours on, so the tick history is the feed log; no false alarm promises)
- **Spoken amounts are expenses** (v91): "$38 school photo money", "invoice
  the Hendersons $480", "I paid $180 for the carpet cleaner" carry
  amount/payer/date onto the task and into the shared ledger at capture time
- **Honest counting** (v87): a long monologue caps at 8 extracted tasks and
  the toast says what didn't fit — silent loss is the one sin a capture tool
  can't afford
- **Photo capture** (v93): snap a photo (school notice, appointment letter,
  medication label, whiteboard) — "Read text from photo" runs it through the
  AI and drops the words into the capture box so the whole pipeline applies;
  or the photo simply rides the note into the journal and shared record.
  Offline: no OCR promises, the photo still attaches
- **A private journal** (v94): "Save to my Journal" whenever the destination
  is Private — text and/or photo kept on-device, no task extraction, no
  space record, shareable later from its Notes card

### Per-cohort reports (one overlay, one print path, a different question each)
- **Care — doctor briefing**: "what does the doctor need to know?" (see below)
- **ADHD/personal — My week in review**: "did using this actually help me?"
- **Family — Week report**: "who carried what, and what's coming?" — household
  completions, who did what / who added what (load sharing made visible without
  blame), the next week's dated tasks
- **Co-parenting — Records summary**: "what would we both sign off on?" —
  completions per parent, expenses as recorded with **N-way settlement lines
  honouring the space's configured split** (v90 — three co-parents or an
  80/20 reality both compute correctly; the fine print states the split),
  neutral wording, drawn from the append-only record
- **Notes in every report** (v85): the family week report gains "Notes this
  week", the records summary "Notes on the record (as written)" — journal
  notes stopped being care-exclusive
- **Readings — from the notes** (v92): the doctor briefing lifts numeric
  observations out of prose ("BGL 4.2", "sats 93", "80ml", "rating it a 7")
  into one trend line per metric with count and range — computed at report
  time, so all existing history benefits, with or without AI
- Every report opens instantly with a progress state and composes locally
  (the care briefing optionally uses AI); all are printable/saveable as PDF
- Reports itemize the record: finished tasks with who ticked them and when,
  each expense as a dated line item with the payer, effort per task in the
  personal reflection — and the open tasks themselves ("Still open"), not
  just a count, in the personal and family reports
- Reachability: the **Journal tab** (one of the four main tabs) is the home
  of every report — a one-tap card per report the user can generate. Each
  space's report also sits on that space's action bar; the personal
  week-in-review is additionally on the focus toolkit strip, the
  personal-view action bar, and the Wins block

### The Journal tab (the review surface)
The fourth pillar of the app's shape: capture (mic) → do (Today) → **read
back (Journal)**. Three sections:
- **Reports** — a card per generatable report: "My week in review" always,
  plus per space: doctor briefing (care), week report (family), records
  summary (co-parenting). The doctor briefing opens directly from here —
  no detour through the history screen
- **Notes** — every raw capture, word for word: zero-task voice notes,
  care observations (labelled with the journal they were shared to), and
  the source transcript behind each extracted task with tick-off links.
  A misdirected journal share can be taken back from here — the journal
  and doctor briefing stop showing the note, while the append-only record
  keeps both the entry and the removal. Each extracted task can also be
  moved to another space or person from here (same sheet as Today)
- **Records** — per shared space: append-only history + CSV/PDF export,
  and the expense ledger for co-parenting spaces

### Sharing & trust (all shared spaces)
- Multiple simultaneous spaces with a space switcher; per-space task scoping
- Attribution on every action: who added, who ticked, with timestamps
- **Append-only history**: the shared record cannot be edited or deleted —
  deleting a task leaves a delete entry. Exportable as CSV and print/PDF
- "While you were away" banner summarising others' activity; optional daily
  digest notification
- Invite links / paste codes; anonymous-first accounts with optional Google or
  email sign-in that links (not replaces) the anonymous identity, restoring
  spaces across devices
- **Read-only roles can't phantom-write** (v89): a circle viewer is never
  offered a writable-looking destination — the chip explains the role instead
  of vanishing, and their captures stay private (v94 gives those words a
  proper private-journal home)
- **Notes never silently diverge** (v91): the shared-note cap is generous
  (2,000 chars) and the rare over-cap note gets an honest toast — a local
  copy and a shared copy are never quietly different
- **Spaces can close with dignity** (v91): Archive keeps the record on-device
  read-only and leaves every daily surface, with the closure itself an
  append-only entry; Reopen restores it; "Export & remove" downloads the
  record as CSV then purges it from this device only, behind a name-typed
  confirmation — the foster-carer/placement-end obligation
- **Role-scoped circles** (v78, Cooee flavor / behind the `circle` flag):
  circle spaces carry roles — owner, co-admin, worker, viewer — enforced by
  the Firestore rules, not the UI. Per-item visibility (circle / team /
  assigned / private) never hides anything from the owner; viewers are
  read-only; invites can only mint worker or viewer (elevation is an
  owner/co-admin act). Proven by an 80-check emulator matrix gating CI
- **Circle worker flows** (v79): support **session brackets** — a worker taps
  Start/End support and everything they tick and note in between reads as
  part of that session in history and handoff (auto-closes after 12h with an
  honest marker; deliberately no per-worker duration totals — not
  time-tracking). **Incident reports** — structured what/when/who/action,
  voice-fillable from the capture box, visible to the author and the circle's
  owners only, append-only, with plain copy that it notifies nobody outside
  the space. Workers/viewers sync circles through the rules-proven filtered
  queries; the AI structuring prompt speaks circle vocabulary (participant,
  members, session talk, observations-are-not-tasks)
- **Plan goals & the Plan Review Pack** (v80): the circle records what the
  supports work toward, in the participant's words; each goal derives a tag
  the AI and the tag picker offer, and tagged work groups under its goal in
  the Plan Review Pack — 12 weeks of the record (goal progress, support
  sessions, incidents, adherence, open tasks, expenses) ready for a plan
  review, AI-summarised with a local fallback. Every render carries
  "Participant-owned coordination record. Not medical, legal, or NDIS
  advice." Circle expenses add provider/ABN + support date, and the ledger
  CSV gains support_date / provider_abn / receipt_ref columns

### Co-parenting pack
- **Custody days**: whose day it is (supports alternating weeks), shown on
  Today, with a "handover tomorrow" heads-up. **Calendar custody** (v92):
  date ranges override the weekly pattern — school terms with one parent,
  holidays with the other — and the range names a person, so a **third
  caregiver** ("kids with Grandma") is a first-class answer
- **Expense ledger**: amounts on tasks (spoken amounts parse at capture,
  v91), receipt photos (compressed on-device), who-paid/who-owes with
  per-task deduplication, **N-way settlement and a configurable split
  ratio** (v90) — set "Zoe 70, Jay 30" in the ledger, everyone sees the same
  maths, and the change is an append-only record entry. The ledger and an
  expenses report section also serve **family-type spaces** (share-houses,
  family businesses)
- **Tone check** (AI): a task heading to the shared list is screened for
  hostile/blaming wording; a neutral, fact-preserving rewrite is offered before
  it lands (fails open when AI is off)
- The append-only history + export doubles as a defensible record

### Caregiving pack
- **Care recipient profile**: one shared picture of the person (conditions,
  meds, preferences), feeding the doctor briefing
- **Medications & routines**: timed, repeating tasks; every tick is a record
  with who/when; a missed dose is flagged on Today for the next carer
  (dismissible, acknowledged per-space)
- **Care journal**: voice/typed observations saved as journal notes (not
  force-converted to tasks), shared to the care space
- **Shift handoff**: "since your last visit" card — what happened while you
  were away
- **Doctor briefing**: one tap turns the last 4 weeks of journal notes, med
  records, misses and **numeric readings trends** (v92) into a printable
  visit brief (AI-composed with a plain-summary fallback; explicitly
  "coordination summary, not medical advice")
- **The care register of speech extracts** (v86): "Dad donepezil every day at
  8am", "Ruby speech therapy Tuesday 10am" — med and appointment noun-phrases
  with no action verb become tasks (they used to extract nothing)
- **One task per dose** (v87): "Keppra at 8am and 8pm" fans into two daily
  tasks, each with its own reminder slot, tick and missed-dose record
- **PRN interval line** (v88): Today shows the last PRN dose from the record
  ("PRN recorded 2:15 pm by Ines — 1 h 40 min ago") and, once a carer enters
  the prescriber's minimum gap, when it ends. The gap is the prescriber's
  number — the app computes, never advises, and says so; setting it is an
  append-only entry; the countdown refreshes every minute
- **Photo notes** (v93): the rash, the discharge sheet, the whiteboard roster
  — photographed, captioned, in the journal, the history and the handoff

### ADHD / executive-function pack
- Voice brain-dump (capture without organising), Break it down, Just One
  Thing, energy matching + easy wins, no-shame carry-over, Wins/streaks, quiet
  mode — surfaced together in a dismissible "focus toolkit" strip on Today
- **My week in review**: a one-tap personal report — tasks you finished with
  total effort minutes, high-effort tasks called out, strongest day, trend vs
  the prior week, and parked/let-go items framed as a skill. Deliberately
  no-shame: a quieter week "is allowed"

### Platform
- Installable PWA: offline-capable, no app store required (store distribution
  is in progress — Play via TWA, Apple via wrapper)
- On-device options: offline speech-to-text (Whisper) and on-device LLM
  summaries (opt-in downloads) for privacy-sensitive users
- Consent-first, anonymised analytics (opt-in); first-party ops dashboard
- Kraken-purple design system, IBM Plex type, monoline icon set, reduced-motion
  support, screen-reader labels, large tap targets

## 4. User flows

### First run (managed/hosted build)
1. **Auth gate**: continue with Google / email / no account (anonymous)
2. **"What brings you here?"** — multi-select cohorts (ADHD, co-parenting,
   caring, household). Selection tunes the toolkit explainer and Today surfaces
3. **Toolkit explainer** — the features that map to their selection
4. **Create your first space** — one tap creates the type-matched space
   (care team / co-parenting / family); solo users can skip
5. **Guided space setup** — persistent checklist per type: add your name,
   invite the others, set custody days (co-parenting) or fill the care profile
   and add a first medication (care)
6. **First-task coach** — lands on capture with a nudge: "tap the mic and say
   what's on your mind"

### Daily capture
Speak (live transcript) → tap Summarize & Add (auto-stops recording, captures
the tail) → input clears instantly, structuring runs in the background → toast
"2 tasks live in 'Mum's care' — View". Zero-task captures are kept as notes in
Ideas and the user is shown where.

### Care shift
Open app → missed-dose banner if anything was skipped → "since your last
visit" handoff card → tick meds as given (each tick recorded with name/time) →
speak a journal observation → "Save to journal". Before a GP visit: History →
Doctor briefing → print/PDF.

### Co-parenting exchange
Task or expense added → tone check intercepts hostile phrasing → other parent
sees it in real time with attribution → custody chip shows whose day it is,
handover flagged the evening before → any dispute: export the append-only
history.

### Delegation (household)
Speak "remind Lulu to return the library books" → task auto-tagged and
assigned to Lulu → Lulu's filter shows her items → she ticks; the family sees
who did what. Daily digest summarises open vs done.

## 5. How cohorts are implemented (extension points)

This is the part that matters for "where else could this apply":

- **`COHORTS`** — self-selected identities with an icon, a feature explainer,
  and one-tap actions (e.g. "create a care-team space"). Adding a cohort is
  adding an entry + choosing which existing features to surface
- **Space types** (`family` / `coparenting` / `care`) — each type gets: a
  type-specific action bar on Today, a guided setup checklist, and pack
  features gated to it. New types are cheap to add
- **Prompts** — the structuring prompt is composed at runtime (known tags,
  household members, date context); cohort-specific extraction rules are a
  prompt change, not an engine change
- **Reports are per-cohort composers on one shared overlay** — adding a new
  cohort's report is writing one compose function over the existing task/event
  data; the loading UX, print path and entry patterns are already generic
- **The trust layer is generic** — append-only events, attribution, exports,
  timed/recurring tasks with miss-flagging: built for co-parents and carers but
  not specific to them
- **Distribution shape** — every space is a small network; each user pulls in
  the people they coordinate with. Cohorts where coordination is inherently
  multi-party fit best

## 6. Honest current limitations

- AI structuring/breakdown/briefing/tone-check run through the live operator
  proxy (30 calls/user/day free, UTC day boundary); past the quota or offline
  they fall back to the built-in heuristic, now with the reason surfaced
- English-only extraction heuristics (hardened against real care/family
  speech by the persona study); non-English captures degrade gracefully to
  journal notes. A four-tier multilingual strategy is planned (ROADMAP
  Phase L) but not scheduled
- Web Speech (default voice path) requires Chrome-family browsers and network;
  the offline Whisper path is an opt-in download; iOS voice needs a native
  wrapper (in progress)
- No payments/premium gating yet; no push notifications on iOS; daily digest
  needs the installed app on Chrome
- Single-operator hosted backend (Firebase) plus a self-host option for
  technical users
- Actively developed: expect rough edges and occasional unpredictable behaviour

## 7. The ask for this review

Given the engine (voice → structured tasks → shared trusted record) and the
pack system above:

1. **Which other communities or cohorts carry a coordination load this maps
   onto?** Consider: disability support networks (participant + support
   workers + family), aged-care villages, foster/kinship care, NDIS plan
   management, chronic-illness self-management, case workers with clients,
   volunteer/emergency-response coordination, share houses, community sport
   clubs, low-literacy or ESL users (voice-first), grief/estate administration,
   post-hospital discharge care, remote/rural families
2. For each candidate: **what's the acute, searched-for pain**, who are the
   2–6 people in the "space", and what would they need that the current packs
   don't have?
3. **Which existing trust features matter most** to them (append-only record,
   attribution, miss-flagging, exports), and are there compliance/reporting
   regimes (e.g. NDIS, aged-care standards) the record could serve?
4. **What would responsible deployment require** — safeguarding, privacy,
   duty-of-care limits (the app deliberately claims "coordination, not
   medical/legal advice")?
5. **Rank the candidates** by fit-to-engine (little new code) vs. impact, and
   flag any where the fit is superficially attractive but actually poor.
