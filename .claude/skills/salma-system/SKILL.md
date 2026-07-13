---
name: salma-system
description: The complete map of Salma — OMNI-PERFORM's AI recruiter persona: her face/portrait (blink+live-talk), her voice funnel, her copy rules, and the recruiter-layer flow. TRIGGER — any work touching Salma's avatar, her voice, her lines, the cold-open/paywall/debrief cards she fronts, or "make her more alive / she talks / her face / her mouth".
---

# Salma — the recruiter persona (OMNI-PERFORM)

Salma is the app's front door: an AI recruiter who screens, coaches, and books the learner's
next interview. Everything she says and shows is deterministic (owner templates, NO LLM). Don't
re-derive this — it's the whole system.

## Where everything lives (client/src)
- **`SalmaTakeover.jsx`** — her cold-open takeover component (`SalmaTakeover`) + her reusable
  avatar (`SalmaPortrait`) + inline machined icons. `SalmaPortrait({fallback,size,speaking})`.
- **`salmaCopy.js`** — every line she can say (`SALMA_COPY`, `salmaLine(key,lang,slots)`,
  `salmaName`/`salmaRole`). Lines have a German original + an `ar:''` masri slot the OWNER fills.
- **`salmaVoice.js`** — the ONE voice funnel. `salmaSpeak({items})` (fixed copy, masri-first),
  `salmaModel({text})` (dynamic German phrase, e.g. a correction). Both → `playNative` with
  `salma:true` (plan-gate exemption so she works from second zero of a fresh account).
- Face assets: `client/public/salma.jpg` (base), `salma-blink.jpg` (eyes closed),
  `salma-talk.jpg` (mouth open) — all edited from the SAME synthetic shot so they align
  pixel-for-pixel. AI-generated (no real person → no likeness risk).

## The living face (how she's "alive")
`SalmaPortrait` = a 3-frame photo stack driven by pure-CSS opacity keyframes:
- **Blink** — `.lids` fades in on a slow 5.4s loop, ALWAYS (every instance, every screen).
- **Talk** — `.mouth` crossfades open/closed ONLY while the portrait has the `talk` class, plus
  a ring glow. Driven two ways: the `speaking` prop, OR the **live signal** (see below).
- **Reduced-motion** strips all of it.

### Live-talk signal (shipped `69704ed`, 2026-07-13)
Her mouth moves in sync with her REAL audio on every card, no per-call wiring:
- `salmaVoice.js` broadcasts a **ref-counted** "is Salma speaking" signal — `salmaSpeak`/
  `salmaModel` wrap their `onStart`/`onEnd`/`onError` (via `withSpeakingSignal`) to flip it.
- `SalmaPortrait` calls `subscribeSalmaSpeaking(setLiveSpeaking)` in a `useEffect` and OR's it
  with the `speaking` prop. So: any utterance anywhere → every visible portrait talks, then stops.
- Ref-count handles overlapping utterances; pre-start errors don't decrement. Audio-sync itself
  is an **owner-eyes gate** (no local ears) — he taps a listen button and watches her mouth.

## Copy & voice rules (owner doctrine — non-negotiable)
- **NEVER author masri** (Egyptian Arabic). Leave `ar:''` slots for the owner. While `ar` is
  empty she speaks the German line in her native voice — she is never silent.
- She goes masri ONLY when EVERY key in an utterance has owner masri (no mid-sentence language flips).
- Voice ids: `salma-de` (Gemini German, warm Kore) / `salma-masri` (Gemini Cairo masri). NOT
  Deepgram Aura (owner ear 07-12: "robotic"). Server `/api/tts-stream` routes + caches → replays free.
- All her lines = fixed templates. No LLM generates her speech.

## Recruiter layer (the flow she fronts)
Cold-open screening → verdict → books Yasmin (the ladder's junior recruiter, once/account, server
flag) → her brain-card identity + notes → paywall re-voiced in her words. Kill switch `SALMA_LIVE`.

## Gotchas / foot-guns
- **New funnel/beacon events** she triggers need an ALLOWED entry in `funnelBeacon` or they 402/drop.
- **Foot-gun #50:** the trial clock starts at the FIRST interview, and the plan-gate once
  402-silenced her cold-open for ALL fresh accounts — her lines MUST pass `salma:true`. If she goes
  silent for new users, check that gate first (fixed `c5b1283`).
- `App.jsx`'s `<Icon>` is NOT exported to sibling components — SalmaTakeover defines its own inline
  stroke-SVG icons; shared audio icons live in `client/src/icons/AudioIcons.jsx`.
- She's rendered in MANY cards (home, debrief, paywall). Change her via the shared component/funnel,
  never per-card, or the app-wide consistency breaks.

## Verify after any Salma change
`cd client && npm run build` + `cd .. && npm run design-lint` (both must be clean) → deploy →
confirm frontend `<meta name="build">` == HEAD → owner watches/listens (voice + mouth = his gate).
