# Operator runbook — shipping the app "ready to use"

Fifteen minutes, once. After this, end users install the app and everything
works with **zero configuration**: no Firebase, no API keys, no snippets.
Creating a space is one tap; invites are short codes with no secrets inside.

You (the operator) take on: a Firebase project on the pay-as-you-go **Blaze**
plan (free quota first, then cents — see the cost model), and responsibility
for user data (publish a privacy policy before inviting strangers).

## One-time setup (P1 — managed sync)

1. **Create the project.** [console.firebase.google.com](https://console.firebase.google.com)
   → Add project (e.g. `idea-todo-prod`, Analytics off).
2. **Upgrade to Blaze** (⚙ → Usage and billing → Modify plan). Required for
   Auth + (later) the AI proxy. Set a **budget alert** at e.g. $25/mo.
3. **Enable Auth.** Build → Authentication → Get started → Sign-in method →
   enable **Anonymous**. (Google sign-in can be added later without code
   changes to this phase.)
4. **Create Firestore.** Build → Firestore Database → Create database
   (production mode).
5. **Paste the rules.** Rules tab → replace everything with the contents of
   [`firestore.rules`](firestore.rules) in this repo → **Publish**.
   These rules require sign-in, restrict every space to its members, and make
   the history append-only *at the server*.
6. **Register the web app.** ⚙ Project settings → Your apps → Web (</>) →
   register (no hosting needed) → copy the `firebaseConfig` object.
7. **Authorize the domain.** Authentication → Settings → Authorized domains →
   add `etheodore15.github.io` (and later your custom domain).
8. **Fill in `managed-config.js`** in this repo with the config from step 6
   (`apiKey`, `authDomain`, `projectId`, `appId`), commit, push. GitHub Pages
   redeploys; from the next app update every phone is in managed mode.

That's it. Verify: open the app fresh (or wipe data) → Settings → Spaces →
"➕ Create a new space" shows name + type + one Create button and no Firebase
instructions.

## What users experience after this

- Install → speak → tasks appear (unchanged).
- Settings → Spaces → name it, pick a type, **Create** — done.
- Invites are `ITODO2-…` codes carrying only the space id + name + type.
- Old self-hosted households keep working; their `ITODO1-…` invites still join.

## Known limitations at this phase

- **Daily digest** notifications don't yet work for managed spaces (the
  service worker's REST fetch can't authenticate). Fixed in P2 by serving the
  digest through the proxy. The in-app family-activity banner is unaffected.
- **Anonymous accounts** are per-browser-profile: clearing site data creates a
  new identity (the person rejoins with the same invite code, and their name
  is re-attributed). Google sign-in (planned) removes this.
- Gemini features still use per-user keys until **P2 (AI proxy)** ships.

## Deploying the backend (Infrastructure-as-Code)

The whole backend lives in the repo and deploys with one command — no
click-ops. After the P1 console setup:

```
npm i -g firebase-tools && firebase login
cp .firebaserc.example .firebaserc      # put your project id in it
firebase functions:secrets:set GEMINI_KEY   # for the AI proxy (P2)
./deploy-backend.sh                     # rules + indexes + functions
./deploy-backend.sh rules               # just re-push rules (e.g. after editing
                                        # the operator UID allowlist)
```

`firestore.rules`, `firestore.indexes.json`, `functions/`, `firebase.json`,
and `deploy-backend.sh` are the transportable backend definition; the
front-end ships via GitHub Pages on `git push`.

## Analytics (first-party always; GA4 optional, opt-in)

- **First-party (always on in managed mode):** each user's *own*
  `cohorts/{uid}` doc accumulates anonymized counters (opens, onboards,
  spaces created, AI calls, feature usage, per-space-type, cohorts, last
  seen). No content, names, or amounts — ever. This is what the dashboard
  reads. To read them, add your Firebase Auth UID to the `isOperator()`
  allowlist in `firestore.rules` and re-deploy rules.
- **GA4 (optional, opt-in):** set `gaId: 'G-…'` in `managed-config.js` to
  offer users an **anonymous analytics** opt-in (onboarding + Settings). Only
  after they consent does GA load, sending the same anonymized events + cohort
  with IP anonymization and Google ad signals off. No `gaId` → the toggle is
  hidden and GA never loads.

## P2 — AI proxy (built, v35)

Removes the last configuration step: with the proxy deployed, every user gets
smart AI (summaries, break-downs, tone checks, doctor briefings) with **no key
of their own**, behind a per-user daily quota you control.

Full deploy runbook: **`functions/README.md`**. In short: `firebase deploy
--only functions:ai` with your Gemini key set as a secret, then paste the
function URL into `managed-config.js` as `aiProxy`. Until you do, AI falls back
to the built-in heuristic (or a user's own pasted key, which always works and
bypasses the quota). This also resolves the digest limitation below for AI —
the digest itself is fixed separately in v36.
