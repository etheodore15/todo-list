# Idea → Todo — full functionality summary & user flows

*Prepared as a self-contained brief for review. The purpose of the review: identify
other communities or cohorts this application could serve, and what adapting it
to them would require. Everything below describes working software unless marked
otherwise. Landing page: https://etheodore15.github.io/todo-list/*

*This is a **living document** — it is amended with every release so it never
drifts from the shipped product. Last updated: v66.*

> **Caveat:** the product is in active development. Some features are new and may
> behave unpredictably; the AI layer currently runs on a built-in heuristic for
> most users until the operator AI proxy is deployed (imminent).

---

## 1. What it is

An installable web app (PWA) that turns **spoken, messy intentions into
structured, shared, delegated to-do lists**. One capture-and-structure engine
serves several audiences through "packs" — feature bundles keyed to the kind of
coordination load the user carries. Current packs: **ADHD / executive function**,
**co-parenting**, **family caregiving**, and **general households**.

The product thesis: the hard part of every to-do tool is getting a real human
intention out of someone's head and into a form others can act on and trust.
Voice-first capture + AI structuring + shared spaces with an append-only record
solves that once; each new cohort is mostly a new surface on the same engine.

## 2. The core engine

**Capture → Structure → Share.**

1. **Capture** — tap the mic and brain-dump. Live transcription (words appear
   as you speak) via the browser speech engine, or a fully offline on-device
   Whisper model (opt-in download) that transcribes in near-real-time 5-second
   segments. Typing works everywhere. A one-line "quick add" exists for
   pre-formed tasks.
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
- Tags with counts and filtering; per-person filter chips
- **Quiet visual mode**: a calmer, lower-stimulus theme
- Undo on destructive actions; edit-in-place for text, dates, tags, scope

### Per-cohort reports (one overlay, one print path, a different question each)
- **Care — doctor briefing**: "what does the doctor need to know?" (see below)
- **ADHD/personal — My week in review**: "did using this actually help me?"
- **Family — Week report**: "who carried what, and what's coming?" — household
  completions, who did what / who added what (load sharing made visible without
  blame), the next week's dated tasks
- **Co-parenting — Records summary**: "what would we both sign off on?" —
  completions per parent, expenses as recorded with a 50/50 balance line,
  neutral wording, drawn from the append-only record
- Every report opens instantly with a progress state and composes locally
  (the care briefing optionally uses AI); all are printable/saveable as PDF

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

### Co-parenting pack
- **Custody days**: whose day it is (supports alternating weeks), shown on
  Today, with a "handover tomorrow" heads-up
- **Expense ledger**: amounts on tasks, receipt photos (compressed on-device),
  who-paid/who-owes ledger with per-task deduplication
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
  records and misses into a printable visit brief (AI-composed with a
  plain-summary fallback; explicitly "coordination summary, not medical advice")

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

- AI structuring/breakdown/briefing/tone-check run on the heuristic fallback
  until the operator proxy ships (users can bring their own Gemini key today)
- English-only extraction heuristics; prompt is language-flexible but untested
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
