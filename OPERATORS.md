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

## P2 preview (AI proxy) — not yet built

A single Cloud Function holding *your* Gemini key: verifies the caller's
Firebase Auth token, applies a per-user daily quota (the free/paid dial),
and forwards the four AI calls. Kills the "paste a Gemini key" step for
everyone. Ships with its own runbook when built.
