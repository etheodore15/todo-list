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

The app works offline after the first load. For fully offline voice recognition
and summaries, enable the on-device AI models in Settings (see below).

## How it works

| Tab | What it does |
|---|---|
| 🎤 **Capture** | Tap the mic and talk. Your words are transcribed live (you can edit or just type). Tap **Summarize & Add**. |
| 💡 **Ideas** | Every captured idea with its one-line summary and full transcript. |
| ✅ **Today** | Your daily todo list, auto-grouped into **Do first / Do today / If time allows**. Tick tasks off, tap the priority chip to re-prioritize, quick-add extras. Unfinished tasks carry over to the next day automatically. |
| ⚙️ **Settings** | Optional Claude API key for smarter summaries, archive finished tasks, delete all data. |

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

One person creates a free Firebase project; everyone else joins with an invite code.

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
    }
  }
}
```

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
