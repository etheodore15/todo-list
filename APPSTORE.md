# App-store readiness — working checklist

Goal: Idea → Todo installable from Google Play (fast path, via Trusted Web
Activity) and the Apple App Store (slower path, needs a wrapper). Items marked
**[you]** need the founder's accounts/decisions; **[Claude]** are code/content
tasks doable in-repo; **[both]** need a decision then code.

---

## Track A — Production foundation (blocks everything else)

- [ ] **[you] Rotate the exposed Gemini key** and store the new one as a
      Firebase secret: `firebase functions:secrets:set GEMINI_KEY`
- [ ] **[you] Deploy the backend**: `./deploy-backend.sh` (Firestore rules +
      indexes + the AI proxy function). One command.
- [ ] **[Claude] Uncomment `aiProxy` in managed-config.js** once the function
      is live → real AI (summarize, break-down, briefing, tone check) for every
      user. A store reviewer will judge the "AI" claims — this must be on.
- [ ] **[you] Add the `FIREBASE_SERVICE_ACCOUNT` repo secret** → the CI deploy
      workflow goes green → site live at `todo-list-50050.web.app`.
- [ ] **[you] Authorize `todo-list-50050.web.app`** under Firebase
      Authentication → Settings → Authorized domains (Google sign-in).
- [ ] **[Claude] Set `appUrl`** in managed-config.js to the live host so invite
      links point at production.
- [ ] **[both] Custom domain?** (e.g. ideatodo.app / a sharpenit subdomain).
      Optional but store listings, invite links and assetlinks are nicer on a
      stable domain. Decide before the Play listing is filed.

## Track B — Store compliance (required by BOTH stores)

- [ ] **[Claude] Privacy policy page** (`privacy.html`, linked from app +
      landing). Must reflect actual practice: local-first storage, Firestore
      sync for shared spaces, Google/email auth, opt-in anonymous analytics,
      AI proxy processing of submitted text, no ads, no data sale. Play and
      Apple both require a public URL.
- [ ] **[Claude] Terms of use page** (lightweight; includes the "family
      coordination, not medical/legal advice" disclaimers we already show
      in-app).
- [ ] **[Claude] In-app account deletion.** Non-negotiable: Apple 5.1.1(v) and
      Google Play both require it because we offer account creation.
      Build: Settings → "Delete my account" → removes `users/{uid}` +
      membership entries + Firebase Auth user, wipes local data, confirmation
      step. Play also wants a web-reachable deletion path — the same flow at
      `/app.html` satisfies it with a documented URL.
- [ ] **[Claude] Support contact** — a support section/page with a contact
      email, linked from app Settings and the store listings.
      **[you]** confirm which address to publish.
- [ ] **[both] Data-safety answers** (Play questionnaire / Apple privacy
      nutrition labels). Draft from the privacy policy: identifiers (email if
      signed in), user content (tasks/notes, synced only for shared spaces),
      optional analytics; no tracking across apps, no ads.
- [ ] **[both] Age rating decision.** Medication *reminders* are
      organizational, not medical advice (disclaimers already in-app) — answer
      questionnaires accordingly.

## Track C — Google Play via TWA (the fast path — target: submitted)

- [ ] **[you] Play Console account** ($25 one-time). Business details, payments
      profile.
- [ ] **[both] Choose the Android applicationId** (e.g.
      `au.com.sharpenit.ideatodo`) — permanent, decide once.
- [ ] **[Claude] Generate the TWA project** (Bubblewrap or PWABuilder) from the
      live manifest; set theme colours, splash, maskable icon (already have).
- [ ] **[you] Create the signing key** (or let Play App Signing manage it) and
      run the AAB build (or hand me the keystore SHA-256 and I prep everything
      up to signing).
- [ ] **[Claude] Publish `/.well-known/assetlinks.json`** with the signing
      cert SHA-256 → the TWA opens full-screen without browser chrome.
- [ ] **[Claude] Store listing copy**: title, 80-char short description,
      4000-char full description (reuse landing messaging), keyword-aware.
- [ ] **[Claude] Store assets**: 512px icon (have), 1024×500 feature graphic,
      6–8 phone screenshots (generate framed shots with Playwright from real
      app states: capture, structured tasks, spaces, meds, briefing, wins).
- [ ] **[you] Upload AAB to the Internal testing track**, add your + your
      daughter's accounts as testers, install from the Play link on her phone.
- [ ] **[both] Fix anything internal testing surfaces → promote to production
      review.**

## Track D — Apple App Store (start now, land later)

- [ ] **[you] Enroll in the Apple Developer Program** ($99/yr) — approval can
      take a day or two, so kick this off first thing.
- [ ] **[both] Reality-check the iOS wrapper constraints before choosing tech:**
      - WKWebView has **no Web Speech API** → in a wrapped app, mic dictation
        must come from (a) the iOS keyboard's dictation key into the text box,
        (b) our on-device Whisper (works, needs the download), or (c) a native
        speech plugin (Capacitor). Decide the iOS voice story.
      - No periodic background sync → daily digest notification won't run;
        in-app "while you were away" banner still works.
      - Apple guideline 4.2 (minimum functionality) rejects thin web wrappers —
        offline mode, voice capture and shared sync are our defence; a
        Capacitor build with a native speech + share-sheet plugin is the safer
        submission.
- [ ] **[Claude] Test the PWA in iOS Safari** (BrowserStack or a real iPhone —
      **[you]** if you have one): install to home screen, storage persistence,
      auth popups (may need redirect flow on iOS), layout.
- [ ] **[Claude] Scaffold the Capacitor iOS project** once the approach is
      decided; wire the same web bundle.

## Track E — Quality gates before any submission

- [ ] **[Claude] Fresh-install end-to-end on production**: new user → auth
      gate → onboarding → create space → invite second device → speak a task →
      AI structuring (proxy) → med reminder → briefing. Scripted + manual.
- [ ] **[you] Real-device pass** on your and your daughter's phones from the
      live URL (not localhost) — she's our best QA.
- [ ] **[Claude] Add minimal error telemetry** (window.onerror → anonymous
      counter) so store-scale breakage is visible on the ops dashboard.
- [ ] **[you] Flip the repo private** once Firebase Hosting is confirmed live
      (GitHub Pages dies at that moment — invite links must already point at
      the new host).
- [ ] **[Claude] Tag the store-baseline release** and document the release
      process (version label + SW cache + tag) in OPERATORS.md.

---

### Realistic shape of tomorrow

Morning (unblocks everything): A1–A6 — key rotation, backend deploy, CI secret,
domain auth, appUrl. ~1 hour of console work, mostly **[you]**, while I build
the compliance pages + account deletion (B).

Afternoon: C — Play Console setup **[you]** in parallel with TWA packaging,
listing copy and screenshots **[Claude]**; internal-testing build on real
phones by end of day. Apple enrollment submitted (D1) and the iOS voice
decision made.

"App Store ready" honestly means: **Play: submitted to review tomorrow is
achievable. Apple: enrollment + wrapper decision tomorrow, submission this
week.**
