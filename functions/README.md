# AI proxy (P2) — operator setup

This Cloud Function lets every app user reach Gemini through **your** key, with
a per-user daily quota, so no end user ever pastes an API key. Prerequisite:
you've done the P1 managed-backend setup (see `../OPERATORS.md`).

## Deploy (one-time, ~10 min)

1. Install the Firebase CLI and log in:
   ```
   npm i -g firebase-tools
   firebase login
   ```
2. From the repo root, point the CLI at your project:
   ```
   firebase use <your-project-id>
   ```
3. Set your Gemini key and (optionally) tune the model and the daily limit.
   Node-20 functions read process env; set it as a secret:
   ```
   firebase functions:secrets:set GEMINI_KEY        # paste your AIza… key
   # optional overrides (defaults shown):
   #   GEMINI_MODEL = (unset — the function auto-discovers the newest flash
   #                   model the key can use and re-discovers if one retires;
   #                   set this only to PIN a specific model)
   #   FREE_DAILY   = 30      (AI calls per user per day)
   #   ALLOW_ORIGIN = *       (lock to https://etheodore15.github.io in prod)
   ```
   In `firebase.json`, bind the secret to the function (see the snippet below),
   or use `functions:config:set gemini.key="AIza…"` on the legacy config API.
4. Deploy just this function:
   ```
   firebase deploy --only functions:ai
   ```
5. Copy the deployed URL (e.g.
   `https://us-central1-<project>.cloudfunctions.net/ai`) into
   `../managed-config.js` as `aiProxy`, commit, push. From the next app update,
   every user gets smart AI with no key of their own.

`firebase.json` binding for the secret:
```json
{
  "functions": {
    "source": "functions",
    "secrets": ["GEMINI_KEY"]
  }
}
```

## What it enforces

- **Auth**: rejects anyone without a valid Firebase ID token (anonymous
  accounts count — they're created silently on first app launch).
- **Quota**: `FREE_DAILY` AI calls per user per day, tracked atomically in an
  `aiQuota/{uid}` document. A user who hits the cap gets HTTP 429; the app tells
  them it resets tomorrow, or they can paste their own key to bypass it.
- **Key hygiene**: the client can only send `contents` / `generationConfig` —
  the model and key are injected server-side and can't be overridden.

## Cost dial

`FREE_DAILY` is the free/paid lever from the cost model. At the default 30/day
with Flash-Lite-class pricing, a heavy free user costs well under 2¢/day. Raise
it for paid tiers (P4) by checking a claim or a `subscriptions/{uid}` doc before
the quota gate.
