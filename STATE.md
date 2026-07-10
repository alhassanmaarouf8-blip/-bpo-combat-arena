# STATE.md — session continuity (read FIRST; rewrite at the END of every session)

## 🔥 ELITE-NIGHT SPRINT (2026-07-10, late) — `00b9d80` all verified live
Owner rage-cycle answered ship-by-ship: (1) `abbd9f2` Bis-zum-Job plan KILLED (owner veto, deletion
pinned by test PLANS.job===undefined); (2) `e92c379` signup UNBROKEN — craft pass had labeled
WhatsApp "(optional)" while server requires it → every no-number signup failed for hours; probe
caught it; foot-gun #42 recorded (half-side contract change); (3) `042a3fb` fight screen de-arcaded
(hairline meters, no flying numbers, no drifting grid, quiet monogram/chips/turn-state);
(4) `9c434ac` EMAIL password reset (owner: "reset is done through email") — sha256 token 45min
single-use, no-enumeration (fire-and-forget send), CGNAT-shaped limits; DORMANT until owner sets
SMTP_USER+SMTP_PASS (Gmail App Password) in Render env — until then client says "nicht verfügbar";
WhatsApp-reset copy DEAD. (5) THE ELITE PROMPT written into design-system SKILL.md (9 laws).
MEASURED live (speech probe, 4 turns): user-quiet→boss-audio gap 1.34–1.57s, DENKT-NACH fills it.
NEXT: owner sets Gmail App Password → verify ONE real reset mail from Render; craft pass continues
(home, debrief, paywall); flagged ship: reset must invalidate old sessions (tokenV in requireAuth).

## 🔥 GEMINI TRUTH+FEEL FIX (2026-07-10, night) — `fd9e042`, verify-live in flight
Owner reported twice: dead-air wait after speaking (words frozen mid-screen), then pasted transcript
proof of SCORED hallucinations (Telugu-script "German", "Hallo."×5, boss-echo lines as DU). Shipped
two bounded commits: (1) `9d9d442` client — CHEF DENKT NACH lights 600ms after your transcript goes
quiet on the Gemini path (was: zero sign the boss heard you; $0 path had a filler, premium had
nothing); (2) `ff48fc8` server — transcriptGuard (wrong_script/repeat_loop/boss_echo, conservative,
15 tests) drops hallucinated turns from scoring+debrief, non-Latin chunks never paint the live
subtitle, and /api/diag/latency finally records the Gemini gap (provider gemini-live; was ZERO
instrumentation). Reviewer caught echo-vs-wrong-boss-line wiring bug → fixed+regression-pinned.
ChatGPT-live question answered again: NO — VAD silence exists on every provider; measure first
(diag/latency now can), mask the rest. NEXT: owner runs one interview → read
/api/diag/latency for the real gemini-live numbers; if p95 ≫ 2s, then investigate region/model.

## 🔥 TRUST-PASS + OUTREACH LIVE (2026-07-10, evening) — `8235ceb` verified (Vercel+Guardian+prod grep)
**NEW APP LAW (owner, answered explicitly): every detail must radiate TRUST · AUTHORITY · COMPETENCE
— scope: the whole app.** Shipped under it: (1) El-Captain mentor chat DELETED (owner pasted its
broken masri — foreign tokens, garbled terms; all 9 client sites + Alhassan.jsx removed, bundle
385→378 kB; server alhassan.js = orphan, deferred); (2) niche fixed: للعرب→للمصريين everywhere +
German hero "gebaut für Ägypten… BPO-Markt in Kairo und deutsche Remote-Jobs" + the confusing
"Wortschatz von 90+ Konten" copy → concrete industries. AR edits minimal/canon-based — HIS pass
invited (marked).
**LINKEDIN OUTREACH EXECUTED (owner: "go do the outreach yourself… not email"):** 3 DMs delivered ✓
(Dina Zakaria TP-recruitment / Nikolay Matanov BPO-accounts KPI-lens / Nareman Osama TA-warm) +
3 invites Pending (Moaz Saleh TaskUs, Rana Khattab, Bola Osama). LENS LAW recorded in
browser-workflows (rule 9): reverse-engineer each message to the recipient's ONE KPI. NEXT SESSION:
check LinkedIn Messaging for replies (message 2 = trainee-batch/Ziel-Stelle expansion, docs/
B2B-OUTREACH-KIT); continue daily connect batches (~8, next = search page 2); NEVER re-message.
**QUEUED (owner orders, not yet done):** VideoLessons narration "must not sound robotic";
the whole-app craft pass under the trust law (surface-by-surface, screenshot-grounded);
on-site-training cost research to arm the B2B message-2 comparison.

## ✅ MUSK-CULL PASS (2026-07-10, evening) — `385d8b9` VERIFIED LIVE (all three proofs)
Owner: "cut anything unnecessary, Musk is beside me." THE FIND: the a92c9ec Trainingslager-UI cut
left a dead limb — the Elite perk still SOLD "das komplette Trainingslager" (3rd phantom perk of
the day), the Boss-Tor gate demanded stations with no UI (locked door for cached clients), and
trainingslagerUnlocked had zero consumers. All cut; reviewer SHIP (verified Elite still justifies
its price: 2× minutes + Ziel-Stelle). KEPT deliberately: VideoLessons (only teaching layer),
Alhassan (warmth layer), Invite/Placement/Push (on-loop). Full ledger + the deferred server-orphan
list (trainingslagerRouter+engine files, /leaderboard route, dead mode payload field — blocked on
the foreign server/server.js WIP) in memory `omni-perform-feature-cull-musk`. Lesson recorded:
amputation needs a nerve-sweep (copy/gates/flags/routes).

## 🔶 ZIEL-STELLE MATCHING SHIPPED (2026-07-10, afternoon) — `3b38d7f`, VERIFY-LIVE in flight
Owner picked THE full-price feature ("something they'd pay full price for on its own") and said go:
the phantom Elite perk from audit #2, built for real. profile targetIndustry (10 KB industries) →
Elite/trial fights pick Teil-3 scenarios industry-first (`pickCsScenario`, unseen→global→cycle) +
BEWERBUNGSZIEL boss framing (never company names); POST /api/progress/target-industry; home
Optionen "Ziel-Stelle" row (honest "ab Elite" tag, OWNER-AR label slot); Elite perk restored TRUE.
Reviewer NO-SHIP→fixed: Object.hasOwn vs '__proto__'/'constructor' bypass (Function source would
have reached the boss prompt!), 401-resync on picker POST. 8 tests. Suite 256/257 (1 = foreign WIP).
✅ VERIFIED LIVE: `3b38d7f` on all three proofs (Render health / Vercel meta / Guardian) + prod
route probe 401. THEN owner: "yes give bis zum job the ziel-stelle too" → `ba84734` SHIPPED +
VERIFIED (PLANS.job zielStelle:true, job perk line, honest upsell tag "mit Elite / Bis zum Job",
plans-flag test pins all four plans; reviewer SHIP; perk lapses with the 365d plan by design).
OWNER CALLS still pending: (1) cull target (Zielplan dead code / Video-slides) — he approved the
principle, never picked; (2) masri label for the Ziel-Stelle picker (OWNER-AR slot in App.jsx);
(3) tag the 10 legacy generic scenarios with industries to deepen 1-scenario industries (7 of 10
industries have exactly one matched scenario today).

## ✅ ROADMAP #5 SHIPPED + VERIFIED (2026-07-10, midday): souverän tuning — `fbb2ee4` live
Badge = (ack || solution) && noInsult (register alone no longer earns it; insults block; taught
KONTER phrases unit-enforced to earn it). Reviewer catches: trailing \b ("dummerweise" never
blocks), AbortSignal feature-guard. 15 tests. Render deploy REQUIRED the manual retry (see above).

## ✅ ROADMAP #4 SHIPPED (2026-07-10, midday): Druck-Leiter scoring spinner — `bbc8807` verified live
"continue" resolved to the top QUEUED ROADMAP item (all STATE NEXT items are owner-only). Shipped:
`scoring` phase in PressureLadder.jsx (endRound's recorder-stop + score-fetch round-trip showed a
frozen countdown; now the standard Debrief spinner) + feature-guarded 12s fetch timeout (bare
`AbortSignal.timeout` would have silently killed the souverän check on Safari≤15/Chrome<103 — the
target market's old devices; reviewer catch) + `endingRef` re-entrancy guard (timer+Fertig double
fire could overwrite a survived verdict). Independent reviewer: SHIP. Guardian green, Vercel stamp
`bbc8807` verified. Behavioral residual (human-only): see the spinner in a real mic'd run.
**NEXT roadmap QUEUED (top→down): #5 Souverän heuristic tuning · #6 Rückfrage-Reflex drill ·
#6b aspect-audit wave · #7 composure metrics.** Untouched: `server/server.js` security-headers
diff = another session's WIP (Jul 8), left uncommitted deliberately.

## ✅ ADVERSARIAL AUDIT #2 (2026-07-10): the PHANTOM Elite perk killed — `bf5771b` live
"Gegner passend zu DEINER Ziel-Stelle" existed NOWHERE in code — a 1.500-EGP plan advertising a
non-existent feature (legal-redline class: provably false paid claim). Replaced with the TRUE
never-advertised Elite exclusive: trainingslagerUnlocked (verified in entitlement()). Every Elite
perk is now implementation-backed (30min ✓ / monatliche Neu-Einstufung ✓ verified in
canStartAssessment REASSESS_DAYS / QA-Latte ✓ CS_RUBRIC / Trainingslager ✓). **PARKED as a real
future feature (owner's call, new-feature gate): Ziel-Stelle matching — cheap now via the KB's 10
industries (profile targetIndustry → CS-scenario picker preference).**

## ✅ ADVERSARIAL AUDIT (2026-07-10): the enemy screenshot found + killed — `252727e` live
Owner: "if you were my enemy, what screenshot would you publish?" THE FIND: Basic perk sells
"Feedback auch auf Arabisch — du verstehst genau, was zu tun ist", but LT explanations are German
and `explanation_ar` was hardcoded `''` — Arabic-mode users' CORE feedback rendered entirely in
German. One screenshot = a paid promise visibly broken. FIXED deterministically: 18 authored
Arabic explanations (one per canonical error class, `AR_EXPLANATIONS` in errorTags.js) wired into
buildGrammar; German grammar TERMS stay German by design; unmapped → honest German fallback.
Logic-proved (DE_CASE→dativ-akkusativ→ar present) + live on Render.
**Runner-up attack vectors (known, monitored, not yet exploitable-in-one-screenshot):**
"3 echte Bewertungen" thinness (honest by design; needs real testimonials); `gradeUnavailable`
debrief state (honest fallback, rare); Gemini→$0 voice downgrade mid-day if the budget cap trips
(watch `gemini_fallback` in the funnel — the cap raise is still the owner's Render env action).
**OWNER EAR-PASS still owed on all AI-authored Arabic (marked in code): BRAIN_COPY 8, listening 8,
AR_EXPLANATIONS 18, card lines.**

## ✅ DESIGNER PASS (2026-07-10, latest): the home has ONE job — `9d7745d`, verified on prod pixels
Owner: "interface doesn't feel intentional/simple/sophisticated." Chose Home-simplification over
full nav restructure (bottom tabs = parked option). Shipped: daily chip de-oranged (was a 2nd
orange START), dashboard = 44px icon at top (was buried in the grid), level+interviewer pickers
moved behind "▸ Optionen · Niveau X" (D2: one tap, never locked), BrainGuide hides its CTA when
the prescription IS the interview (externalInterviewCta) so the directive frames the single orange
button. Screenshot verified: topbar → hero(title/ladder/directive) → ONE orange → quiet Optionen.
GOTCHA for future file surgery: client/src/App.jsx is CRLF — node string markers must use \r\n.
PARKED (owner's call later): 3-tab bottom nav (Heute/Übungen/Fortschritt) — the deeper surgery.

## ✅ GOD-VERIFICATION ACCURACY SWEEP (2026-07-10, late) — shipped `13c23d5`+`47342a7`+`d4191c8`
Per-area verdicts (proof in the session report):
A home guidance ✓ (velocity=etaSessions-to-next-level, guide=deterministic engine, proof card
fixed earlier) · B post-interview feedback ✓ (this week's fragment+duplication fixes; drills use
display fragments) · C compounding ✓ VERIFIED AT EVERY LINK (weakLog/SRS→dossier→AKTE forcing
block in prompt→delta measured vs lastTargetRule→rendered; nothing write-only) · D assessment ✓
(600ms voiced gate; blocker quotes substring-verified; conservative CEFR; residual: blocker
rule-NAMES are LLM-chosen, quote-gated but not LT-verified) · E Druck-Leiter ✓ (souverän = only
positively-detected moves; silence teaches; barbs stripped) · F lessons — **FIXED THE REAL GAP**:
Trainingslager was tier-adaptive but never read the student's errors ("Phase 2" promised in
lessons.config, never built); now measuredWeakClasses(weakLog)→station boost + honest measured
reason. Coverage: 17 error classes ↔ 29 lessons; unmatched classes flow to SRS/drills (covered
elsewhere, noted) · G BRAIN_COPY: 8 masri strings SHIPPED on explicit owner order, then corrected
twice by HIM.

## ✅ OWNER-AR BACKLOG FINISHED (`5e0fbbe`, both stamps verified live ~45s)
Every Arabic slot filled with verified masri (owner: "just finish the job"): listening ×8 questions,
trainingslager measured-reason, job SUB_AR, KB landing row, peak-offer, proof card, reset card,
typing link, velocity line, first-debrief reveal. Domain terms verified (أكونت = owner canon,
تيم ليدر كول سنتر = Forasna verbatim). No outcome promises anywhere. HIS native pass on all
AI-authored masri remains the standing invitation — everything is marked in code.

## ⚠ THREE NEW OWNER LAWS (recorded as memories — binding)
1. **masri-verification-law**: every masri word verified against real Egyptian usage online BEFORE
   shipping ("الخط الألماني" was invented; his verbatim canon: "جاهز تشتغل في أكونت ألماني").
2. **no-promises-legal-redline**: NEVER promise passing/hiring — encouragement only; the single
   redline = nothing sue-able ("bis du den Job hast" → duration framing, fixed).
3. Pricing shows VALUE only, never client names (perk added: "die App führt dich: Diagnose → EIN
   Training → Beweis im Interview").

## ✅ SHIPPED (2026-07-10, night): "Der Vater führt" WOW pass — `b074262`, verified on prod pixels
Owner's new FAILURE METRIC (doctrine, recorded in north-star memory): *"if the user could find ANY
better way to the goal than this app, I failed."* The pass makes the existing brain FELT:
R1 BrainGuide moved INSIDE the hero card above the pickers (verified: prod screenshot shows journey
bar + خطوتك الجاية + why-line + blue CTA commanding the home); R2 first-debrief "DIAGNOSE
ABGESCHLOSSEN" reveal (Baustellen from deterministic grammar + journey bar + leading promise —
owner's next real interview is the human verification); R3 honest velocity line (etaSessions,
null-silent below evidence floor); R4 aha share (?src=aha, engine-verified numbers only); R6
landing row 3 promises the leading; R7 accuracy receipts (debrief trust footer + landing
anti-chatbot line). Gemini probe PASS post-deploy. **R5 = OWNER ONLY and now the single
highest-impact pending item: the BRAIN_COPY masri (8 strings in BrainGuide.jsx — placeholder masri
LIVE in prod today) + the OWNER-AR backlog (listening ×8, landing rows ×2, job-plan SUB_AR, reset
card, peak-offer card, aha share wording).**

## ✅ SHIPPED (2026-07-10 late): the BPO-depth plan P0–P4 — `9efab80` on main
Owner approved the plan ("EXECUTE"). What went live: +14 industry scenarios (+DSGVO verification
keyPhrases in 3), +24 terminology BPO_PHRASES, +4 floor-language screening questions, CS_RUBRIC
aligned with the real QA scorecard (closing pair + hold etiquette + binding-promise anger),
+8 floor-language listening ITEMS (TL announcements; question_ar = OWNER-AR mirrors), landing
feature row + 1 perk per plan selling the depth ("Trainiert die echte Einstellungslatte…", "90+
Konto-Typen"). Gates were all green; 2 real german-check flags fixed (Telecom→Mobilfuk—sic:
Mobilfunk; sind→ist). Verification ladder ran post-deploy (health/Vercel stamps + gemini probe) —
check the last background task output if resuming mid-verification.
PARKED (owner): written email-register drills (speaking first); boss persona floor-language
enrichment (separate ship). OWNER-AR slots now open: listening ×8, landing row ×1, job-plan SUB_AR.

## PREVIOUS ⏸ (superseded — the pause note below is now historical)
**OWNER'S RESUME ORDER (verbatim intent, 2026-07-10): "when the limits return back you will
proceed first with your continuous research."** ⇒ Step 0 on resume = CONTINUE THE RESEARCH
(deepen the KB: more Egypt-confirmed accounts via Wuzzuf/Glassdoor/Facebook job groups, richer
per-account terminology, deeper TL/HR persona evidence — e.g. Glassdoor Egypt interview reviews per
BPO, salary/shift realities, account-specific escalation flows). THEN run the paused ship ladder
below (german-check → gates → feature/bpo-depth → merge → verify live). Research method that works
is in memory `german-bpo-knowledge-base`.
**The BPO depth build (owner: "go deep in the drills, 60+ German accounts, no new features"):**
- ✅ WRITTEN, NOT COMMITTED: `docs/kb/GERMAN-BPO-KB.md` (94 accounts, evidence-tiered E/H/I; 10
  industry terminology banks; TL floor-language KPI glossary; TL/HR archetype→boss mapping;
  interview-shape research; sources) + `server/scenarios.js` expanded: **+14 industry-deep
  CS_SCENARIOS** (telecom Kündigung/Portierung, Router-Störung, Retoure, Fintech Doppelbuchung/
  Kontosperrung, Airline Umbuchung/Gepäck, Delivery, Logistik Zustellversuch, Energie Nachzahlung,
  Versicherung Schaden, Streaming Abbuchung, B2B Werbekonto), **+24 industry BPO_PHRASES** (SRS
  seed), **+4 floor-language screening questions** (AHT/QM/Leitfaden/Warteschleife).
- ⚠ NEXT STEP (was mid-flight when paused): `node --check server/scenarios.js` +
  `node scripts/german-check.mjs server/scenarios.js` (result lost to a tool error — NOT yet
  verified) → lint → tests → build → ship on `feature/bpo-depth` → merge (owner pre-approved the
  depth build) → verify live → probe one fight to confirm a new scenario can be served.
- Integration is ADDITIVE-ONLY (unseen-first pickers serve new scenarios automatically; SRS seeding
  dedupes) — no new features, per owner's constraint. Brands stay anonymous in-app (doctrine).
- STILL OWED IN THE REPORT: the Musk/Hormozi lens (Musk: the 60-account list is inventory, the
  real requirement is "drills feel like MY account" — delete breadth that doesn't reach a drill;
  Hormozi: sell the depth — "trained on your exact account type" belongs on the paywall/landing as
  offer value, not hidden in code).


## WHERE WE ARE (2026-07-10, late) — aesthetic pass 1–5 SHIPPED + VERIFIED (`15ba2db`)

Owner asked for the A→Z aesthetic review (screenshot-grounded), then "do all of them, 1 to 5."
All five live on prod, verified by fresh prod screenshots:
1. **Desktop landing FIXED** — root cause was `index.html` clamping `.auth-shell` to 560px+zoom
   while a two-column `.landing-grid` already existed in App.jsx; plus ratings/auth/legal were
   loose grid children scattering into stray cells. Now: hero+mockup+features left, rating+signup+
   legal right, Arabic hero in 4 clean lines (was 1–2 words/line). Phones untouched.
2. **Hands-free instruction contradiction gone** — typing demoted to a quiet "⌨ Lieber tippen?"
   link (state `typeOpen`); one voice-first line: "Sprich einfach — ich höre zu und sende
   automatisch."
3. **Persona-true chips** — hardcoded "HOCHDRUCK" → per-bossId map matching the home picker
   (GEDULDIG/SACHLICH/SKEPTISCH/HOCHDRUCK/STRENG/LOCKER); `funnel.bossId` now sent in
   SCENARIO_INFO handler.
4. **BossAvatar replaced** — cartoon face (read male under YASMIN) → premium initials-ring
   ("Y · HR", glass, emotion color + glow, speaking halo only — no idle loop). Legacy SVG +
   FACE_PARAMS excised (~90 lines).
5. **Gaming chrome softened** — red ⚔ENDGEGNER → blue LIVE-INTERVIEW pill; boss HP blue→orange
   (never a red wall); KOMBO→SERIE; 🥊 chrome → Icon (paywall header, backend gate).
Owner-visual residual: the debrief screen + the peak-offer card still unseen by owner (needs his
real interview). Minor niggle spotted: back-chevron slightly overlaps "BOSS HP" label on mobile.

## PREVIOUS (2026-07-10) — teardown executed; ball is in the OWNER's court (distribution)

**Owner ordered the elite-marketer teardown, then "do everything except the domain." ALL SHIPPED
AND VERIFIED LIVE (HEAD `49dcf75`):**
- `ccf6120` CGNAT-safe rate limits (signup 8→60/h/IP; login 80/10min/IP + strict 8/10min per
  IP+account via new `rateLimit keyExtra`). Was a real launch-burst signup killer.
- `48a9ef6` `boss_spoke` now counts Gemini fights (fired only on the text path before — funnel
  showed 42 connected/23 spoke and HALF the fights looked silent; they weren't).
- `f79a6f2` hero grammar: **Der** erste Interview-Trainer (was "Das" — on a German-teaching app).
- `cf97843` the conversion pack: (1) WhatsApp password reset — `GET /api/auth/reset-info` +
  "Passwort vergessen?" on login (registered number = identity; owner resets via admin);
  (2) offer card at the debrief's emotional peak (non-paying only, quiet blue, "Das war Interview
  Nr. N — bleib dran bis zum Job" + PLÄNE ANSEHEN); (3) **one-time plan `job` "Bis zum Job"**:
  2.000 EGP einmalig (offer→1.000), Basic limits, 365d via normal billingPeriodEnd lapse,
  `billingPeriod:'once'` server-decided. Verified live: plans endpoint shows it, a real pending
  payment created (`ref BB45E9, 1000 EGP, once`).
- `49dcf75` `docs/LAUNCH-KIT-2026-07-10.md` — tagged `?src=` links per FB group (client support
  verified at App.jsx:86), post skeleton with OWNER-AR slots, in-app-browser escape line, funnel
  readout. **THE #1 FINDING: ~74 opens/day, untagged, single-channel — distribution, not product,
  caps revenue. Only the owner can post.**

**Teardown verdict (funnel-ordered):** 8 of ~120 openers in 2 days ever saw a price → fixed the
reachability (peak offer card) + the buyability (one-time plan) + the traffic legibility (src
links). Parked, owner-only: real domain (~$10/yr, he said "not for now"); named testimonials.
**Voice sweep same night: 6/6 HRs on Gemini native audio, real speech (RMS 3.5–4.5k), no fallback.
False alarm corrected: the "dead start button" was the probe matching the how-to card's TEXT — the
real button works (WS opens); harden future probes with `locator('button', {hasText})`.**

## NEXT (in order)
1. **OWNER: post with the launch kit** (one group/day, tagged links, Chrome line). Watch
   `curl -s .../api/diag/funnel` for `open@<src>` + `paywall_shown` + `gemini_fallback`.
2. Owner fills the OWNER-AR slots (login reset card, peak offer card, job-plan SUB_AR + perks).
3. Owner ear-test on mobile data (jitter heal + the 6 voices) — still the human-only residual.
4. If a persona ever feels transcript-gated again: that fight fell back — check `gemini_fallback`
   in the funnel + the Render `gemini-gate` log line.

## PREVIOUS (2026-07-09, ~23:30) — ✅ proof-card SHIPPED to main (owner-approved merge)

**The trial→paid question, answered with data, then fixed.** Owner asked "why do trials never pay —
whatever it is, remove it." Funnel beacons (`GET /api/diag/funnel`): **31 interview starts → 4
debriefs seen.** Root cause found in code: `_onClose` never called `_finishSession` — anyone who
closed the tab / dropped network mid-interview was billed trial minutes and got **zero feedback**.
The core promise (proof your German moved) evaporated for 87% of trials.

**Shipped `9f3afb7` (merge of `feature/proof-card`, owner approved the merge to main):**
1. `_onClose` now runs `_finishSession` for fights that never reached a debrief (persist-only —
   `_send` is a no-op on a dead socket; the MIN_REAL_ANSWERS=1/MIN_REAL_WORDS=8 floor still holds).
2. A tiny `p.lastDebrief` snapshot persists (≤2 LanguageTool-verified corrections from the user's
   OWN sentences + 1 quote-gated structure win). **Owner rule, enforced by construction: NEVER
   correct the merely suboptimal — no real error ⇒ store nothing.** (His words: "it must never
   correct anything just because it is suboptimal — no noise.")
3. Home shows it once as a quiet blue card ("Aus deinem letzten Interview", wrong→right), then
   `POST /api/progress/debrief-seen` clears it. Arabic = OWNER-AR slots.
Gates were all green (lint / 164 tests / german-check / design-lint / vite build).
**VERIFY-LIVE state: deploy was still baking at session end — /health must show `9f3afb7`, then**
`GET /api/progress` (throwaway) has `lastDebrief`, `POST /api/progress/debrief-seen` → `{ok:true}`.
If unverified, do that FIRST next session.

**FUNNEL IS HALF-BLIND (found while answering him — queued, not built):**
- NO `signup` beacon event exists at all (canonical set calls for it). Trial→paid is unmeasurable.
- `mic_started` fires only on the old $0 path (`startHandsFreeTurn`); `enterGeminiMode` emits only
  `mic_failed` — so mic health on the CURRENT (Gemini) path is invisible.
- Suspicious day-signal: 07-08 (pre-Gemini) 22/22 connected→boss_spoke; 07-09 (Gemini) 23/31.
  Consistent with the intermittent-jitter defect below. Daily counts, not proof.
- The 1 failing test is `naturalnessWiring.test.mjs` — ANOTHER SESSION'S untracked WIP (imports a
  non-existent `pickCallback` from claimLedger). Not mine, don't ship/fix blind.

## PREVIOUS (same day, ~20:30) — ✅ Gemini Live is CONFIRMED LIVE

**RESOLVED.** The live interview is now actually running on Gemini Live native audio. Every gate is
green and the key is accepted at the socket. Proven on prod (build `d8445b0`), not asserted:

```
useGeminiAudio:true    +1.85s     ← only emitted on Gemini's setupComplete ⇒ key ACCEPTED
boss_audio_delta       ×302       ← boss really speaking native PCM
gemini_ended           0          ← never fell back
boss_speech            0          ← zero Groq text-pipeline frames
gemini spend           $0.0078
```

Reproduce any time, no human needed: **`node scripts/qa/probe-gemini-gate.mjs`** (exit 0 = PASS).
Committed on branch `feature/gemini-gate-probe` (pushed; **not** merged to main — INTENT.md forbids
pushing to main).

**Why /health alone was never proof:** it reports `USE_GEMINI_LIVE && !!GEMINI_API_KEY` — i.e. the
server *wants* Gemini. A Cloud-console key passes auth then gets `1008 method blocked` at
BidiGenerateContent and the server falls back **silently**. Only AI-Studio keys work. The probe
tests acceptance, not intent.

## THE ONE NEXT STEP — fix the INTERMITTENT crackle (`صوت خرفشة مستمر`)
Owner heard continuous crackle with **no intelligible word**; minutes later it "worked", and
**Yasmin + Lukas sound good**. Both are true — the defect is intermittent. Measured, not guessed:

- The **bytes are fine.** Captured `boss_audio_delta` straight off prod → WAV: RMS 3738, zero-crossing
  0.18, all chunks even-aligned, 10.5s of real speech. Server relay does exactly one base64 decode →
  one re-encode. **Gemini and the server are innocent.**
- The **client player starves.** Patching `AudioBufferSourceNode.start()` on the live app:
  **run 1 = 100 gaps >5ms; run 2 (identical code) = 0 gaps.** `geminiVoice.js:42` does
  `if (this._playHead < now) this._playHead = now` — a hard resync with **no jitter buffer**. When
  chunks arrive slower than realtime (jitter — i.e. *Egyptian mobile*), playback runs dry, resyncs,
  and tears the waveform. Each tear is a click; ~100 of them over 10s **is** the continuous خرفشة,
  and it destroys intelligibility. On a fast link the buffer never runs dry → sounds perfect.
- **✅ SHIPPED `286bc9c` (owner: "خرفشة لسه موجودة… fix that permanently") — the ADAPTIVE heal.**
  His "never slower, ever" law is enforced STRUCTURALLY in `geminiVoice.js`: a turn start always
  begins at `now` (response onset byte-identical to before); only after the FIRST mid-speech tear
  of a session does refill scheduling gain a 180ms lead (buffer absorbs jitter thereafter). Clean
  session ⇒ lead never arms ⇒ zero cost. Barge-in `flush()` resets `_lastEnqueueMs` so the lead can
  NEVER delay a post-interruption reply. The naive always-on buffer remains REJECTED.
- **"Boss waits for my words on screen" (Karim-or-Tarek fight) — root truth:** on the Gemini path
  transcripts are DISPLAY-ONLY (App.jsx even holds text until voice starts). That symptom is the
  signature of a **silent fallback to the $0 text pipeline** (there, STT→LLM→TTS = transcript
  genuinely gates the boss). All 6 personas probed clean on Gemini (onset 1.4–1.8s, 0 fallback) —
  so it's transient, and was invisible. **Now countable:** funnel events `gemini_fight` /
  `gemini_fallback` + `mic_started` on the Gemini mic path. Read `GET /api/diag/funnel`:
  `start_clicked − gemini_fight` = fights that never got Gemini that day.
- **Secondary (real, unfixed): 3× leaked 24 kHz `AudioContext`.** Only ONE `GeminiVoicePlayer`
  should exist per fight, but three 24 kHz contexts are created (a 4th @48 kHz is `bargeInMonitor`/
  `ClipRecorder`, expected). Browsers cap ~6 contexts per page → repeated fights can exhaust them
  and kill audio entirely. `enterGeminiMode` IS guarded by `geminiModeRef`, so the extra contexts
  come from elsewhere — **find the other constructor before fixing.**

## AFTER THAT — owner ear-test
Headless proof cannot judge what only a human can:
- real turn-taking latency (needs you actually speaking — the probe only measures the greeting)
- whether the 6 boss voices match gender/character (`BOSS_GEMINI_VOICES` map is a first pass)
- does it cut you off? can you interrupt her? does it end like a human?
Use **earbuds** (barge-in defaults ON; on speakers set `GEMINI_BARGE_IN=0`).

## OPEN FLAGS (raised 07-09)
1. **⚠ ACTION ON OWNER — the $5 cap silently downgrades the product.** Owner confirmed 07-09 the key
   IS billing-enabled ($300 credit), so the memory's "free-tier, no billing" note is **stale/wrong**.
   `geminiBudget.js:26` = `Number(process.env.GEMINI_BUDGET_USD || 5)` (read once at module load).
   The 35s probe cost $0.0078; a full ~7-min interview costs materially more, so **$5 trips within a
   few dozen interviews** and every fight then drops back to the robotic $0 path with no
   user-visible signal. **Fix = one Render env var, no code, no deploy:** set
   `GEMINI_BUDGET_USD=<usd>` → save → Render restarts → done. *Render gotcha (learned the hard way):
   JS-injected values do NOT persist in their env form — the save toast fires but saves nothing. Type
   with real keyboard events.*
2. **⚠ The cap is NOT a real guard now that a card is attached.** `geminiBudget` persists spend to
   `server/data/gemini-budget.json`, which is **ephemeral on Render** → spend resets to $0 on every
   redeploy/restart. A crash-loop or a busy deploy day can therefore bill well past the nominal cap.
   Keep the number modest. Real fix would be persisting spend to the DB, not the filesystem.
3. **Greeting onset was +3.56s** (click → first audio byte). Memory recorded ~2.15s on 07-05. Not
   alarming (includes WS connect + setup + the text kick) but worth an eye — the whole point of
   Gemini was ~1s latency.
4. **The older QA probes are silently broken.** `probe-interview.mjs` (and the `tour*.mjs` family)
   fill only email+password, but signup now requires a **WhatsApp number** and validates
   client-side — so "Konto erstellen" is a no-op and the probe dies before the interview. Fixed in
   `probe-gemini-gate.mjs` only; the others still need the one-line fix.

## SAFETY NET
- Kill Gemini instantly: `GEMINI_LIVE_DISABLED=1` (or `GEMINI_LIVE_ENABLED=0`) → stable $0 path.
- Raise the cap: `GEMINI_BUDGET_USD=<usd>`.

## HOW TO SHIP FROM HERE
Edit ONE bounded thing → `npm run lint` → `node --test server/…` → `git add <files by name>` →
commit → **branch `feature/<slug>`, never main** (INTENT.md) → verify by proof. Never `git add -A`
(shared OneDrive tree; other sessions edit live).
