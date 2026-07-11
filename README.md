# Idea → Todo

A tiny installable Android app (PWA) that lets you **speak your ideas**, get them
**transcribed and summarized**, and automatically **mapped into a prioritized daily
todo list**.

No app store, no build tools, no account — it runs entirely on your phone.

## Install on your Android phone

1. Enable **GitHub Pages** for this repository
   (repo → Settings → Pages → deploy from the `main` branch, root folder).
   Note: on GitHub's free plan, Pages only works on **public** repositories.
2. On your phone, open **Chrome** and go to:

   ```
   https://etheodore15.github.io/todo-list/
   ```

3. Tap the Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. Open **Idea → Todo** from your home screen like any other app.
   The first time you tap the mic, allow microphone access.

The app works offline after the first load (except voice recognition, which uses
Google's speech service and needs a connection).

## How it works

| Tab | What it does |
|---|---|
| 🎤 **Capture** | Tap the mic and talk. Your words are transcribed live (you can edit or just type). Tap **Summarize & Add**. |
| 💡 **Ideas** | Every captured idea with its one-line summary and full transcript. |
| ✅ **Today** | Your daily todo list, auto-grouped into **Do first / Do today / If time allows**. Tick tasks off, tap the priority chip to re-prioritize, quick-add extras. Unfinished tasks carry over to the next day automatically. |
| ⚙️ **Settings** | Optional Claude API key for smarter summaries, archive finished tasks, delete all data. |

### Summaries & priorities

- **Default (offline, free):** a built-in heuristic splits your idea into action
  items, picks the key sentence as the summary, and assigns priority from urgency
  cues in your own words ("urgent", "today", "must" → high; "this week", "soon" →
  medium; "someday", "maybe" → low).
- **Optional (smarter):** paste an [Anthropic API key](https://console.anthropic.com/)
  in Settings and Claude (Haiku) summarizes and prioritizes instead. If the API is
  unreachable it falls back to the offline heuristic.

### Privacy

All ideas and tasks are stored only in your phone's browser storage. Nothing is
uploaded anywhere unless you enable Claude summaries (then only the idea text is
sent to the Anthropic API with your own key).

## Files

- `index.html` — the whole app (UI + logic, no dependencies)
- `manifest.webmanifest` — makes it installable
- `sw.js` — service worker for offline use
- `icons/` — app icons
