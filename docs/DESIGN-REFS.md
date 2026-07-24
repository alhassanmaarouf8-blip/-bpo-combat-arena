# DESIGN REFERENCES — the owner's taste, written down

**Why this file exists.** On 2026-07-24 the owner said: *"the design of the app looks like an AI made
[it] — I have shown you before 100 things from Mobbin, why nothing was implemented."*

He was right, and the reason is a process failure, not a disagreement:

- The Mobbin MCP is **paid-only** and returns `requires a paid plan` on every query (verified again
  2026-07-24). Zero-spend rule → no subscription.
- His references were shown in chat and **never written down anywhere**.
- So every new session starts blind, cannot see what he liked, and reinvents the same generic
  dark-navy card layout — the thing he keeps rejecting.

**This file is the fix. Any reference the owner gives goes in here, permanently, before any design
work starts.** A session that has no reference must READ this file rather than invent a direction.

---

## THE DIAGNOSIS (2026-07-24) — why the current UI reads as "AI made"

Observed on the live Training home at 1499px. These are craft failures, fixable without any
reference, and they are the reason the app has the generic LLM-product look:

1. **Every region carries an uppercase micro-label.** One screen had nine: `DEINE AKTE`,
   `DEINE MISSION`, `DEIN NÄCHSTER SCHRITT`, `DEIN AUFTRAG`, `ERSTE MESSUNG`, `01 · WARUM JETZT`,
   `02 · FERTIG, WENN`, `03 · DANACH`, `DAS GRÖSSERE ZIEL`. Designed products label almost nothing —
   rank comes from position, size and space. Labelling every box is the loudest AI tell there is.
2. **One card style for everything.** Rounded rect + 1px translucent border + navy fill, repeated at
   every level of the hierarchy (card inside card inside card), so nothing outranks anything.
3. **The two-colour law is declared but not used.** Blue + orange, "one orange action per screen" —
   yet the Training home had NO orange at all, so the primary button did not look primary.
   (Prototyped 07-24: orange CTA + 30px task title instantly gave the screen a focal point.)
4. **Decorative background beams** that carry no meaning.
5. **Flat type scale.** Almost everything is 11–13px with one large title; no mid-range steps, so
   the eye has no path through the screen.
6. **Process explanation above the fold**, competing with the action the user came to take.

**Anti-slop rule this implies:** a label is a confession that the layout failed to communicate.
Delete the label and fix the layout instead.

---

## OWNER REFERENCES

> **PASTE THEM HERE.** For each: the app/screen name, what specifically he likes about it
> (layout? type? restraint? colour? motion?), and the screenshot path if saved under
> `docs/design-refs/`. Screenshots are better than links — Mobbin links are paywalled and rot.

### HOW TO ACTUALLY GET REFERENCES (the mistake that cost a session)

**Mobbin's MCP is paid, but mobbin.com in a browser is NOT — and the owner is already logged in
there.** On 2026-07-24 a session tested the MCP, got `requires a paid plan`, and concluded "no
references available" — while a browser was open the entire time. Do not repeat this. Open
`mobbin.com/search/apps/ios?content_type=flows&filter=flowActions.Subscribing+%26+Upgrading`
(484 subscription/upgrade flows) or the Onboarding / Creating Account flow filters, and LOOK.
Screens lazy-load; wait ~4s before screenshotting or you capture grey skeletons.
Do NOT commit Mobbin screenshots into this repo (their content, not ours) — write the
observations down instead, which is what the rest of this file is for.

### OBSERVED 2026-07-24 — Headspace, "Onboarding" flow (21 screens), iOS 393×852

The single most important finding, and it is not a visual one:

- **Account creation offers `Continue with Apple / Google / Facebook / Email / SSO`.** There is no
  email-verification wall between signing up and using the product. One tap, you are in.
  This is the direct answer to our measured killer: 6 of 11 real accounts have `activeDays: 0`
  and `lastActive: null` — they created an account and never came back, which is the signature of
  our hard `emailVerificationRequired: true` gate (auth.js) forcing them to leave the app, find an
  email, and return. Google/Apple identities arrive pre-verified, so the gate disappears entirely
  rather than being weakened.
- Visual patterns worth copying (all consistent with our existing laws):
  - **One message per screen.** "Breathe in." "Welcome to Headspace." Nothing else competes.
  - **Enormous whitespace.** Roughly half of each screen is empty. Air is the premium signal.
  - **One filled primary button + one quiet secondary** ("Create an account" / "Log in"). Never
    two things fighting to be primary.
  - **Zero uppercase micro-labels.** Consistent with the label cull we shipped the same day.
  - Warm illustration carries the brand; the UI chrome itself is almost invisible.

_(Owner's own references still welcome here — paste screenshots and one line each on what you
like about them.)_

### What is already known about his taste (from memory, not guesses)

- **Blue + orange only.** No neon cyan/green/violet/gold. No Orbitron. (`design-system` skill)
- **One orange object per screen**; everything else blue/neutral.
- **Inter**, type floor 11px, 44px touch targets.
- **"Instrument, never arcade."** He killed an arcade combo mechanic and a Skinner-box game costume
  that a previous session built into the hiring tool (`bpo-ai-slop-audit-0713`).
- **Rejected explicitly:** Duolingo-copy, gamification, recolouring-as-redesign
  (`bpo-akte-home-redesign-0722`).
- **Rejected layouts:** an 80vw+`zoom` stretched desktop ("the UI is garbage"), and a 460px centred
  phone column (reverted). Replaced 2026-07-24 by a 1000px single ordered column, no zoom,
  no masonry — accepted on screenshots.
- **Nav simplicity is #1:** 3 bottom tabs, home = ONE continue action, zero home decisions
  (`feedback-navigation-simplicity-0718`).
- **Protected forever:** the INTERVIEW control in the first Training viewport, the Einstufung,
  Übungen, Fortschritt.

---

## PROCESS (do not skip)

1. Read this file before any design work.
2. Prototype against the LIVE app in the browser and screenshot it — never ship a design decision
   that has not been seen as pixels (`god-verification` foot-gun #70).
3. Show the owner the screenshot BEFORE shipping. He judges by pixels, not descriptions
   (`feedback-show-visible-change-first-0724`).
4. Any new reference or verdict he gives → append it here in the same session.
