# Idea → Todo

A tiny installable Android app (PWA) that lets you **speak your ideas**, get them
**transcribed and summarized**, and automatically **mapped into a prioritized daily
todo list**.

No app store, no build tools, no account — it runs entirely on your phone.

## Install on your Android phone

1. Host the app. Two options (either works; you can run both in parallel):
   - **GitHub Pages** — repo → Settings → Pages → deploy from `main`, root
     folder. Free-plan Pages needs a **public** repo.
   - **Firebase Hosting** — `./deploy-backend.sh hosting` puts the app in the
     same Firebase project as your data + functions, at `<project>.web.app`,
     with free SSL and a custom-domain option. See `OPERATORS.md` → *Hosting
     the app on Firebase*.
2. On your phone, open **Chrome** and go to:

   ```
   https://etheodore15.github.io/todo-list/
   ```

3. Tap the Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. Open **Idea → Todo** from your home screen like any other app.
   The first time you tap the mic, allow microphone access.

The app works offline after the first load. For fully offline voice recognition
and summaries, enable the on-device AI models in Settings (see below).

## First run

On first launch the app asks **"What brings you here?"** — pick any of Focus &
ADHD, Co-parenting, Caring for someone, or Household & family (more than one is
fine). It then shows a tailored **toolkit**: the exact features that help the
audiences you chose, with one-tap shortcuts to set them up. Change it any time
from Settings → **What I use this for**. Your choice is stored on your device
(and, in the hosted service, associated with your account so the operator can
see which audiences use which features).

## Accessibility

The app is built for screen readers and keyboard use: status messages and the
live transcript are announced (ARIA live regions), every dialog is a proper
modal with a label and closes on **Escape**, keyboard focus is always visible,
all controls have accessible names, and the OS "reduce motion" setting is
honoured automatically (a manual **quiet visual mode** in Settings goes
further — muted colours and no motion).

## How it works

| Tab | What it does |
|---|---|
| 🎤 **Capture** | Tap the mic and talk. Your words are transcribed live (you can edit or just type). Tap **Summarize & Add**. |
| 💡 **Ideas** | Every captured idea with its one-line summary and full transcript. |
| ✅ **Today** | Your daily todo list, auto-grouped into **Do first / Do today / If time allows**. Tick tasks off, tap the priority chip to re-prioritize, quick-add extras. Unfinished tasks carry over to the next day automatically. |
| ⚙️ **Settings** | Optional Claude API key for smarter summaries, archive finished tasks, delete all data. |

### Dates, repeats, editing & undo

- **Scheduled tasks** — say or type *"pay rent on friday"*, *"book the dentist for
  the 14th"*, *"call mum tomorrow"* and the task lands in an **📅 Upcoming**
  section instead of today. Tap the date chip (or a task → **📅 When**) to
  reschedule any task.
- **Repeating tasks** — *"bins every tuesday"*, *"meds every morning"*, *"rent on
  the 1st of every month"*. A finished repeat quietly respawns at its next
  occurrence on the daily rollover. Tap the ↻ chip (or task → **↻ Repeat**) to
  change or remove the rule.
- **Edit a task** — tap the task text to open its detail panel, then **✏️ Edit**.
- **Undo** — ticking or deleting a task (or deleting an idea) shows a toast with
  an **Undo** button for a few seconds.

### Brain-friendly mode (ADHD & neurodivergent-first)

- **🪄 Break it down** — on any task's detail panel. AI splits the task into
  3–7 tiny steps where the first is doable in under two minutes ("clean the
  kitchen" → "put 5 things in the dishwasher"…). Tick steps off individually;
  finishing the last one ticks the whole task. Works best with a Gemini key;
  the built-in mode splits compound tasks.
- **🎯 Just one thing** — button at the top of Today. Full-screen view of a
  single task (the app picks the highest priority one, and surfaces the next
  tiny step if the task was broken down), a huge Done button, and
  "not this one" to shuffle. No list, no overwhelm.
- **🔋 Energy levels** — every task gets an effort estimate (low / medium /
  high, with rough minutes). Tap the chip to correct it. A **"🔋 easy wins"**
  filter shows only quick low-effort tasks for low-capacity moments, and the
  progress line shows the realistic total ("~2h 15m of doing left") with a
  gentle heads-up when the day is overloaded.
- **No shame, no red** — nothing ever says "overdue". A task that has quietly
  carried over for 5+ days asks once: *still matters?* → **Yes — today**,
  **Someday** (parked, dateless, zero pressure), or **Let it go** (delete,
  with undo). Someday tasks live in a collapsed 🌙 section until you give
  them a new date.
- **🏆 Wins** — a collapsed section listing what you finished today, your
  weekly count, and a streak that counts *any* activity and never breaks
  loudly. Closing loops, not punishment mechanics.
- **🌿 Quiet visual mode** — Settings toggle: softer colours, zero animation
  or flashing, for lower sensory load.

### History & records (co-parenting / care teams)

Every space keeps an **append-only history**: who added, edited, ticked,
rescheduled, moved, or deleted each task, with timestamps. Deleting a task
leaves a delete entry — the list tidies, the record doesn't. Everyone in the
space sees the same history (Settings → the space → **📜 History & export**),
and one tap exports it as **CSV** or a printable **PDF** — useful where a
shared, provable record matters (mediation, care coordination).

*Honesty note:* the history is append-only at the app **and** at the
Firestore rules level, but because members hold the space keys, a determined
member could write via the API directly. Treat it as a shared record, not
courtroom-grade evidence — that upgrade needs a hosted backend (on the
roadmap).

**🕊 Tone check** — on spaces created as *Co-parenting*, anything you type or
edit is checked (using your Gemini key) before it lands on the shared list.
Hostile or blaming wording gets a side-by-side neutral rewrite — use it, keep
yours, or cancel. Neutral text passes silently, other space types are never
checked, and if the API is slow or unavailable the task goes through
untouched.

### Care team features (spaces created as *Care team*)

- **💙 Care recipient profile** — a care space is *about* someone (Mum) who
  isn't a device holder. Fill in their profile once (Settings → the space →
  💙 Care profile): name, age, conditions, allergies, key contacts, notes.
  It's shared with the whole care team, shown at the top of that space's Today
  view, and folded into the doctor-visit briefing automatically.
- **Routines & meds** — say *"give mum her Ramipril at 8am every morning"*:
  the task repeats daily with a 🕗 time chip, and every tick is attributed
  (who gave it, when) — a de-facto medication administration record in the
  space history. A routine not ticked by end of day is recorded as
  **⚠️ missed** in the history and respawns fresh — yesterday's missed dose
  never merges into today's.
- **📝 Care journal** — voice-capture an observation (*"mum seemed dizzy this
  morning"*) as an idea, then tap **Share to [care space]** on the idea card.
  Ideas stay private unless you share them; shared notes join the space's
  append-only history alongside meds and tasks.
- **🩺 Doctor briefing** — in the care space's History view: one tap has
  Gemini turn the last 4 weeks of notes, medication adherence, and open
  concerns into a printable one-page brief to hand to the GP. Coordination
  summary only — it never gives medical advice.
- **Shift handoff** — reopening a space's history shows a *"since you last
  looked"* divider, so whoever comes on duty sees exactly what the others
  did.

### Expenses & the shared ledger (co-parenting / any space)

- **💵 Log an expense** on any task (detail panel → 💵 Expense): an amount and
  an optional **receipt photo**. The photo is compressed on your phone to a
  small JPEG (≤250 KB) and stored in the space's append-only ledger — no
  cloud-storage account or credit card needed.
- **Shared ledger** (Settings → the space → **💵 Ledger**): every expense with
  who paid, running totals per person, an equal split, and — for a two-person
  space — a plain "**Alex owes Sam $40.00**" line. One tap exports the whole
  ledger as **CSV** (receipts flagged), and tapping a receipt opens the photo
  full-size.
- **🗓 Custody days** (co-parenting spaces): one parent marks the weekdays the
  kids are with them (Settings → the space → 🗓 Custody days); both parents
  then see the schedule from their own side. The Today view shows *"Today is
  your day with the kids"* or *"Today is Alex's day"*, with a **🔄 handover
  tomorrow** flag on the day before a switch. Tick **"alternates every other
  week"** for week-on/week-off arrangements. Schedule is shared on the space.
- **👤 Per-space members** (Settings → any space → 👤 Members): give a space
  its own member list so tasks there are delegated to the right people —
  useful when your co-parenting space and your household have different
  members. Spaces with no list of their own fall back to your global members.

> **Scope note:** care features coordinate a family/care team. They are not a
> medical device, give no dosing or clinical advice, and pairing dose times
> with a phone's native alarm is still recommended (PWAs can't fire
> minute-exact alarms).

### On-device AI (fully offline, no API key)

In Settings you can download two small AI models that then run entirely on your
phone — no internet needed afterwards, nothing leaves the device:

- **Offline voice recognition** — OpenAI's Whisper (base, ~80 MB) transcribes your
  recordings on-device. Works on any modern phone browser (GPU-accelerated where
  available, CPU fallback otherwise) and replaces Android's cloud speech service.
  The model downloads once (use Wi-Fi) and is cached in browser storage; the
  inference runtime ([transformers.js](https://huggingface.co/docs/transformers.js)
  + ONNX Runtime) is bundled with the app in `vendor/`.

### Summaries, priorities & tags

- **Default (offline, free):** a built-in heuristic splits your idea into action
  items, picks the key sentence as the summary, and scores priority and tags from
  cues in your own words.
- **Free smart summaries (recommended):** paste a free
  [Google Gemini API key](https://aistudio.google.com/apikey) in Settings — no
  credit card needed — and Gemini generates the summary, tasks, priorities, and
  tags. Far smarter than the heuristic.
- **Optional (paid):** an [Anthropic API key](https://console.anthropic.com/) uses
  Claude instead. Order of preference when keys are set: Gemini → Claude →
  built-in heuristic (which also covers you offline).

> On-device LLM summaries were tried (Qwen3, LFM2, Qwen2.5 via WebGPU) and removed:
> current ~0.5B models need more memory than phone browser tabs reliably provide.
> The vendored runtime still supports it, so this may return as models shrink.

### Privacy

All ideas and tasks are stored only in your phone's browser storage. Nothing is
uploaded anywhere unless you enable Claude summaries (then only the idea text is
sent to the Anthropic API with your own key).


## Family sync

Shared lists are organised as **spaces** — one space per group: a family
household, a co-parenting pair, a care team around someone. You can belong to
several spaces at once (e.g. "Home" + "Mum's care"); a switcher on the Today
view filters between them, plus a 🔒 Personal lane for tasks that never leave
your device. New tasks land in whichever space you're viewing, and any task
can be moved between spaces (or made private) from its scope chip. Several
spaces can share one Firebase project.

To set up the first space: one person creates a free Firebase project;
everyone else joins with an invite code.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (any name, disable Analytics).
2. Build → **Firestore Database** → Create database (production mode).
3. In the **Rules** tab, paste and **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{hid} {
      allow get, create, update: if true;
      allow list, delete: if false;
      match /items/{item} {
        allow read, write: if true;
      }
      match /events/{event} {
        allow read, create: if true;   // append-only history
        allow update, delete: if false;
      }
      match /receipts/{receipt} {
        allow read, create: if true;   // append-only expense ledger (v32)
        allow update, delete: if false;
      }
    }
  }
}
```

> Upgrading from a version before v32? Re-paste these rules (the `events` and
> `receipts` blocks are new) so shared history and the expense ledger work.
> The `update, delete: if false` lines are what make history and receipts
> append-only at the server, not just in the app.

Households are addressed by long random IDs that only your invite code contains —
the rules forbid listing them, so knowing the invite is what grants access.

4. Project settings (⚙) → Your apps → **Web app (</>)** → Register → copy the `firebaseConfig` snippet.
5. In the app: Settings → **Family sync** → paste the snippet → **Create household** → **Share invite code** with your family. They paste it under "Join household" — no Firebase setup needed on their devices.

Tasks sync in real time (and offline changes catch up automatically). Ideas and
voice transcripts never sync — they stay on the device that captured them.

## Files

- `index.html` — the whole app (UI + logic)
- `ai-worker.js` — Web Worker running the on-device AI models
- `vendor/` — bundled transformers.js + ONNX runtime (no CDN dependency)
- `manifest.webmanifest` — makes it installable
- `sw.js` — service worker for offline use
- `icons/` — app icons
- `tests/` — browser regression tests (Playwright)
