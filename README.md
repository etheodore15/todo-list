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
- **On-device summaries** — Qwen2.5 0.5B (~480 MB) summarizes, prioritizes, and tags
  ideas locally. Needs GPU acceleration (WebGPU): Chrome on Android 12+, or Safari
  on iOS 26+. Devices without WebGPU fall back to the built-in heuristic.

Models download once (use Wi-Fi) and are cached in browser storage. The inference
runtime ([transformers.js](https://huggingface.co/docs/transformers.js) + ONNX
Runtime) is bundled with the app in `vendor/`, so the installed app is fully
self-contained.

### Summaries & priorities

- **Default (offline, free):** a built-in heuristic splits your idea into action
  items, picks the key sentence as the summary, and scores priority from urgency
  and importance cues in your own words.
- **On-device AI:** enable the local model above — best privacy, no ongoing cost.
- **Optional (cloud):** paste an [Anthropic API key](https://console.anthropic.com/)
  in Settings and Claude summarizes and prioritizes instead. Order of preference
  when enabled: on-device model → Claude → heuristic.

### Privacy

All ideas and tasks are stored only in your phone's browser storage. Nothing is
uploaded anywhere unless you enable Claude summaries (then only the idea text is
sent to the Anthropic API with your own key).

## Files

- `index.html` — the whole app (UI + logic)
- `ai-worker.js` — Web Worker running the on-device AI models
- `vendor/` — bundled transformers.js + ONNX runtime (no CDN dependency)
- `manifest.webmanifest` — makes it installable
- `sw.js` — service worker for offline use
- `icons/` — app icons
- `tests/` — browser regression tests (Playwright)
