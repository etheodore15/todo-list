# Monetization pathway — both products

*Living document (CLAUDE.md rule): whenever a feature ships that creates or
moves a premium lever, update this map in the same release. Levers are listed
here BEFORE they're enforced, so pricing decisions are deliberate, not
retrofitted. Last updated: v77.*

## Principles (constraints on every lever)

1. **Never paywall the trust layer.** The append-only record, attribution,
   exports (CSV/PDF), and leaving-with-your-data are the product's ethical
   spine — free forever, both products. (For Cooee this is close to a legal
   posture: it's the participant's record.)
2. **The app must work without paying.** The heuristic engine, browser speech,
   core tasks/spaces stay free — premium buys *more capacity and convenience*,
   never basic function.
3. **Meter what costs us money; gift what doesn't.** Levers attach to real
   marginal cost (AI calls, cloud transcription minutes, storage) or to
   clearly-premium surfaces (advanced reports), not to arbitrary feature
   fences.
4. **Per-product pricing, one engine.** Flavors set limits via
   `FLAVOR.limits` / feature flags; enforcement lives in engine code that
   reads config (ARCHITECTURE.md rule 5).

## The lever map

| Lever | Free tier (today) | Premium | Costs us? | Status |
|---|---|---|---|---|
| Cloud voice transcription length | 120 s per capture (`FLAVOR.limits.voiceSeconds`) | Extended/unlimited captures | Yes (~0.2¢/min Gemini) | **Enforced v77** (metered proxy path only; browser speech & on-device Whisper uncapped — they cost us nothing) |
| AI calls per day (structuring, breakdowns, briefings, tone check) | 30/day/user (proxy `FREE_DAILY`) | Higher/unlimited + faster model | Yes | Enforced since proxy deploy; premium tier = raised quota per uid |
| Plan Review Pack (Cooee) | — | $19/mo · $190/yr per circle (workers always free) | Marginal | Priced in brief §8; gate at export polish, not at record access (principle 1: the raw history stays exportable free) |
| Report history depth | Current period (7d/28d windows) | Any period, quarter/annual packs | No | Future lever — cheap to build on the composer framework |
| Spaces per account | Unlimited today | Cap free at ~2–3 spaces if needed | Storage only | Hold — don't constrain growth loops early; spaces ARE the viral mechanism |
| Members per space | Unlimited | — | No | Never gate: invites are the distribution engine |
| Receipt photo storage | Compressed thumbs in Firestore | Full-res originals in Cloud Storage, longer retention | Yes | Future lever (pairs with NDIS 5-year retention advice) |
| Daily digest / notifications | 1/day summary | Smart timing, per-person digests | No | Weak lever — keep free, drives retention |
| On-device AI (Whisper/local LLM) | Free (user's own hardware) | — | No | Never gate: it's the privacy option; charging for privacy is off-brand |
| Priority support / concierge onboarding (Cooee circles) | — | Included in circle subscription | Time | Bundle into the $19/mo, matters for this cohort |

## Product-level shape

- **ideatodo (consumer):** freemium single tier. "Premium" ≈ $4–6/mo:
  extended voice, high AI quota, deep report history, full-res receipts.
  Anchor: cheaper than one coffee; the buyer is the household organiser.
- **Cooee:** per-circle subscription ($19/mo · $190/yr), participant or
  family pays (often from Core–Consumables — see the compliance-locked
  wording in the brief; never "claimable"). Workers free forever — they are
  the adoption channel, not the customer. The Plan Review Pack is the
  headline paid artifact; extended voice + raised AI quota ride along.

## Enforcement mechanics (as built)

- `FLAVOR.limits.voiceSeconds` — per-capture cap on the metered transcription
  path (client, v77) + a 4 MB request cap at the proxy (server, so the client
  cap can't be bypassed).
- Proxy `FREE_DAILY` per-uid daily counter (server, since v35/deploy).
- Premium unlock path (future): an entitlement doc per uid (set by the
  payment webhook), read by the proxy for quota/caps and by the client for
  limits — one flag, both surfaces.

## Open decisions

- Payment rails: Play/App Store billing once store-distributed (15%) vs
  Stripe on web (~3%) — likely both, web-first during pilot.
- Whether ideatodo Premium and a Cooee circle subscription share an
  entitlement for the same account (probably yes: one "supporter" flag).
- Trial shape for Cooee circles (suggest: full features until first Plan
  Review Pack export, then subscribe — the value moment).
