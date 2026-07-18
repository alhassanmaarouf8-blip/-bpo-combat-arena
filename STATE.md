# STATE.md — session continuity (read FIRST; rewrite at the END of every session)

## 🎨 PHASE-3 CONGRUENCE: NON-APP RESIDUES = 0 (2026-07-18 afternoon)
- Converted the last 15 non-App.jsx design-lint congruence residues onto `ui/primitives` + tokens:
  Assessment (local primaryBtn/ghostBtn/ghostBtnWide deleted → `actionBtn` aliased import; stop-rec
  button #ef4444 → var(--bad) dark-text; two caps-900 headers → 600/'0.02em'; verdict ~level 900→600),
  VideoLessons (same const swap; 🎬 chrome emoji stripped; slide title 900→700; playBtn 900→600),
  DailyTraining (result border used INVALID CSS `'var(--accent)55'`/`'#ef444455'` — the border
  silently never rendered — now valid rgba tokens), InterviewPassPreview + VacancyTargetCard
  badges 900→600.
- Local congruence design-lint now reports **22 residues, ALL App.jsx** (fight/debrief verdict
  visuals — owner-tuned surface; needs its own careful dedicated ship, not regex). Client build green.
- The CONGRUENCE lock (extended `scripts/design-lint.mjs`) stays UNCOMMITTED until App.jsx hits 0.
- Also this session: Codex enforcement (repo `AGENTS.md` §codex block pushed `b15a158`; global
  `~/.codex/AGENTS.md` machine-wide). ⚠ AGENTS.md has an UNCOMMITTED round-3 edit (never-ask +
  10-attempts persistence) — the harness classifier blocked me committing it; owner commits it
  himself for Codex-cloud parity (local Codex already reads it from disk).

## SPOKEN GOLD SOFTWARE LOOP CLOSED (2026-07-16)
- The first frozen spoken criterion is fully executable from production: the owner admin can now
  download a minimal `no-store` spoken-gold profile snapshot after baseline and final retest.
- The snapshot allowlists only immutable account ID, required server-recorded session fields, and
  bounded Salma transfer-proof state. Contact, payment, push, vacancy, free-form feedback,
  transcript, and unrelated profile fields are excluded and regression-tested.
- Closure evidence is recorded in `docs/SPOKEN_GOLD_LOOP_CLOSURE_2026-07-16.md`.
- This closes the software/operational gap; it does not fabricate external accuracy. Owner smoke,
  five consenting Egyptian A2-B2 candidates, and two blind qualified German raters remain required.

## SPOKEN GOLD-STUDY PROVENANCE REPAIR (2026-07-16, branch `codex/listening-transfer-v2`)
- Replaced operator-supplied study verdicts with decisions re-derived from the exact persisted server
  profile snapshots through the production speaking-measurement and transfer-proof validators. The
  operator can no longer type the app score, bottleneck, prescription, or mastery result.
- The frozen `handle-clear-request` candidate rule requires exactly two distinct, reliable,
  server-recorded customer-service opportunities. Thin, duplicated, tampered, typed, or mixed
  evidence abstains; matched-only improvement cannot become transferable mastery.
- The hidden decision is bound to immutable-account and evidence hashes. Finalization reloads the
  original private snapshots, re-derives every decision, re-verifies media, and rejects edited packs
  or hidden keys before aggregate scoring.
- Added fail-closed checks for profile path/symlink/size/JSON/prototype-key safety, account reuse,
  participant reuse, baseline mutation, private-data leakage, source-file collisions, and end-to-end
  finalizer operation. Raw audio remains private and the audio-to-profile link is explicitly a
  procedural capture attestation, not a fabricated cryptographic guarantee.
- Complete verification is green: secret scan, lint, design lint, syntax, 658/658 server tests,
  production client build, and 40-file artifact verification. No microphone, Gemini Live, Deepgram,
  TTS, voice, persona, timing, fallback, WebSocket, pricing, authentication, payment, or UI path was
  changed.
- External truth remains honestly pending: owner smoke, five consenting Egyptian A2-B2 candidates,
  and two blind qualified German raters must supply real spoken evidence before any accuracy claim.

## SPOKEN GOLD-STUDY REVIEW PACKAGE (2026-07-16, branch `codex/listening-transfer-v2`)
- Froze the first target-population criterion before inspecting participant results:
  `handle-clear-request` in the customer-roleplay archetype, below 75/100, requiring exactly two
  reliable server-recorded spoken opportunities and explicit abstention on thin, conflicting,
  typed, interrupted, duplicated, or unreliable evidence.
- Added a complete local, non-deployed, privacy-safe spoken review package. It creates a blinded
  media pack, hidden app-decision key, two independent qualified-rater templates, inter-rater report
  before app comparison, disagreement-only adjudication, and aggregate final beta-gate report.
- Owner smoke is mechanically excluded from accuracy. Target participants are participant-disjoint
  across three calibration, one development, and one locked holdout slot. The final report includes
  modality, exact construct, sample sizes, Cohen's kappa, Wilson intervals, correct abstention,
  expert bottleneck agreement, prescription agreement, harmful-misdirection count, matched transfer,
  novel transfer, and invalid mastery claims without participant hashes or raw evidence.
- Adversarial gates reject private fields, absolute/traversal paths, reused media, missing or
  extension-mismatched clips, retention beyond 90 days, thin app selection, same-rater substitution,
  incomplete/unattested reviews, agreement rewriting, and completion presented as mastery.
- Complete verification is green: secret scan, lint, design lint, syntax, 656/656 server tests,
  production client build, and 40-file artifact verification. Voice, microphone, personas, audio,
  WebSocket behavior, pricing, authentication, payment, learner UI, and production were untouched.
- Honest blocker: no owner spoken smoke case, five consenting Egyptian target candidates, or two
  qualified independent German ratings have been supplied. The package is operational, but spoken
  diagnosis, prescription, and transfer accuracy remain externally unproven until those inputs exist.

## HUMAN-REFERENCE ARTICLE REWRITE REPAIR (2026-07-16, branch `codex/listening-transfer-v2`)
- Found and removed a demonstrated harmful behavior in the existing article-gender detector: it
  always suggested a nominative definite article, even when the learner used another case or an
  indefinite article. It could therefore turn `dem Arbeit` into the wrong `die Arbeit` and change
  intended definiteness.
- The detector now preserves case and definiteness only when one replacement is deterministic,
  abstains when case cannot be recovered, and ignores spaced nominal compounds such as
  `das Sprache Sprechen`, where the apparent noun may not be the article's head.
- Development before repair: six rewrites, zero reference-supported, five neutral, one contradicted.
  After repair: five signals, four rewrites, three supported, one grammatical reference-neutral,
  zero contradicted.
- Single-open independent document-disjoint holdout: 256 documents / 4,397 sentences, 1,274 human
  `R:DET:FORM` annotations, 11 detector signals, ten rewrites, nine reference-supported, one neutral,
  zero contradicted. This supports safety for a narrow bounded lexicon only; it is not general
  article/case accuracy and deliberately leaves almost all determiner errors uncovered.
- Complete verification is green: secret scan, lint, design lint, syntax, 650/650 server tests,
  production client build, and 40-file artifact verification. Voice, microphone, personas, audio,
  WebSocket behavior, pricing, and workflows were untouched. No deployment or push was performed.

## HUMAN-REFERENCE SUBJECT–VERB REPAIR (2026-07-16, branch `codex/listening-transfer-v2`)
- Added a precision-first subject–verb agreement detector for explicit adjacent `ich/du/er/es/man/wir`
  with closed paradigms for nine high-frequency auxiliaries and modals. Ambiguous `sie/Sie/ihr`,
  governed infinitives, truncated turns, and low-confidence ASR evidence fail closed.
- Development evidence: six rewrites across 2,503 sentences; four moved closer to the human target,
  two were reference-neutral but grammatically compatible with the human rewrite, and zero were
  contradicted.
- Single-open independent document-disjoint holdout: 233 documents / 3,803 sentences, 199 human
  `R:VERB:FORM` annotations, three detector rewrites, all three reference-supported, zero neutral,
  zero contradicted. The tiny rewrite count supports safety only; it is not a population accuracy
  percentage and the detector deliberately leaves 196 annotations outside its narrow coverage.
- The learner-visible correction is available only after two occurrences, retains the existing
  quote/ASR honesty gates, and makes no hiring or interviewer claim. Voice, microphone, personas,
  audio, WebSocket behavior, pricing, and workflows were untouched.
- Complete verification is green: secret scan, lint, design lint, syntax, 647/647 server tests,
  production client build, and 40-file artifact verification. No deployment or push was performed.

## HUMAN-REFERENCE CORRECTION BENCHMARK (2026-07-16, branch `codex/listening-transfer-v2`)
- Completed the first evidence-driven product repair: the separate Arabic-L1 verb-final detector
  now abstains from automatic rewrites on incomplete one-token clause tails and across `bitte` when
  missing punctuation may hide a new main clause. Detection still counts the signal.
- Frozen development result: 8/8 rewrites moved closer to the human target, zero neutral or
  contradicted. Single-open document-disjoint holdout: 225 documents / 3,685 sentences, 13 signals,
  four rewrites, three reference-supported, one neutral, zero contradicted. The small rewrite count
  is a safety signal, not a population accuracy percentage; 274 general word-order annotations remain
  largely outside this narrow detector.
- Audited primary expert sources. MERLIN/Falko-MERLIN is legally usable now for written German;
  DISKO may add professional TestDaF/longitudinal evidence after access review; MuSSeL is the best
  located German L2 spoken-proficiency candidate but requires registration and commercial-use
  permission; HAMATAC is restricted to research/teaching and was not ingested.
- Acquired the official WNUT 2018 Falko-MERLIN GEC archive outside the repository and pinned its
  archive plus six input SHA-256 hashes. The frozen test contains 2,337 sentences and 3,748 human
  grammar edits after excluding punctuation, spelling, orthography, and no-op annotations.
- Ran the exact production spoken-grammar filter without its learner-facing six-rule display cap.
  Attributed baseline: 378 predictions, 208 exact span+replacement matches, 55.03% exact-reference
  precision, 5.55% recall, and 19.77% F0.5. This written benchmark exposes severe under-detection; it is not
  overall app, spoken, listening, coaching, transfer, BPO-readiness, or hiring accuracy.
- The remote checker is not fully reproducible: an earlier complete run produced 373 predictions
  and 210 exact matches. Across runs, 369 edits were stable and 13 sentences drifted. Pin every
  prediction hash and do not claim deterministic results until the provider/version is frozen.
- Added frozen-corpus verification, resumable privacy-safe prediction generation, exact scoring,
  Wilson intervals, error-type/rule attribution, malformed/duplicate/incomplete fail-closed tests,
  and package commands. Raw learner text and full predictions remain outside the repository.
- The WNUT test split is consumed and must not be used for tuning. Develop any rule changes on
  train/development data and evaluate once on a new untouched holdout. No learner-visible grammar
  rule was changed from this result alone.

## EXTERNAL ACCURACY SYNTHESIS COMPLETE (2026-07-15, branch `codex/listening-transfer-v2`)
- Recovered the completed Fable 5 deep-research workflow from its preserved Claude workflow records;
  Fable's quota expired after research completion but before its final presentation.
- Independently acquired and audited MERLIN v1.2 outside the app repository: CC BY-SA 4.0, 1,033
  unique German learner texts, including 64 Arabic-L1 texts, with fair CEFR labels and target
  hypotheses. This supports written-grammar/CEFR-proxy benchmarking only, not spoken accuracy.
- Common Voice German is suitable for a separate transcription WER/CER benchmark with explicit
  scripted/spontaneous limitations. Public datasets still cannot validate spoken bottleneck
  diagnosis, prescription quality, novel transfer, BPO readiness, or hiring outcomes.
- Found a provenance defect: `server/coach.js` merges guarded LLM grammar corrections ahead of
  LanguageTool corrections but labels the merged output `grammarSource: 'languagetool'`. No learner
  claim should rely on that field until the sources are separated and independently benchmarked.
- Added the authoritative evidence synthesis and zero-spend benchmark design at
  `docs/EXTERNAL_ACCURACY_BENCHMARK.md`. Current product truth: internally verified (623/623 tests),
  externally unproven.
- Grammar provenance is now corrected without changing learner-visible ordering: each correction is
  tagged `llm` or `languagetool`, responses distinguish `merged`, and provider availability is
  explicit. Four focused provenance regressions pass.
- Added a frozen MERLIN v1.2 manifest plus a local, non-deployed preparation/scoring harness. The
  real bundle passes its SHA-256/count gates and produces a deterministic 614 calibration / 199
  development / 220 locked-holdout split with no raw learner data or author IDs written.
- The harness fails closed on wrong hashes/counts, malformed or duplicate predictions, repository
  output paths, and accidental holdout access. Four focused benchmark regressions pass.
- Complete verification is green: secret scan, lint, design lint, syntax, 631/631 server tests,
  production client build, and 40-file artifact verification.
- Next highest-value action: generate source-separated predictions on calibration data, score the
  document-level external baseline, then add correction-span adjudication before opening holdout.
- Completed the LanguageTool calibration arm on all 614/614 calibration documents through the exact
  production checker. Aggregate result: accuracy 56.84% (Wilson 95% CI 52.89–60.70), precision
  68.28%, recall 71.93%, specificity 21.31%, F0.5 68.98%. This is document-level `count_G`
  agreement, not spoken or correction-span accuracy.
- The result proves LanguageTool cannot be described as unquestioned authority. It does not prove
  every unmatched positive is harmful; 144 unmatched-positive documents require rule/span-level
  adjudication against the target hypotheses.
- Added a resumable, throttled source-separated prediction generator with bounded exponential retry,
  exact manifest/hash gates, no holdout access, no repository output, and no raw learner data output.
- LLM-only and merged arms remain unrun because no authorized zero-spend `GROQ_API_KEY` exists in the
  local environment; the generator fails closed rather than inventing results.
- Next highest-value action: create a blinded adjudication sample from the 144 unmatched positives,
  classify true correction vs annotation mismatch vs harmful false correction, then calibrate rules
  on calibration data only. Do not open development or holdout yet.
- Generated a deterministic blind pack from 40 unmatched-positive documents: 138 short corrections,
  with provider/rule/label/CEFR/L1/hash hidden and contact/URL/number data redacted. Full documents
  never enter the pack.
- Internal single-AI triage of the first frozen 50 (explicitly not gold truth): 33 valid, one
  acceptable alternative, 15 potentially harmful, one unclear. Many suspected harms were wrong-case
  changes or partial fixes that left the promoted sentence ungrammatical.
- Do not disable whole rules from this signal: `DE_AGREEMENT` had 27 usable and nine suspected
  harmful corrections. The required next gate is two independent qualified German raters on the
  same frozen blind pack, inter-rater agreement, then adjudication. Development/holdout remain closed.
- Completed the privacy-safe two-rater gate machinery: qualification/independence attestations,
  complete-review and tamper validation, nominal Cohen's kappa, blinded disagreement generation,
  and final adjudication that cannot rewrite agreements. Human artifacts fail closed outside the
  repository; only aggregate text-free evidence can be committed.
- Generated two ID-only 138-correction review templates outside the repository. They are deliberately
  incomplete and confer no evidence until two distinct qualified German reviewers independently fill
  and attest them. No reviewer, rule calibration, development split, or holdout result was invented.
- Next highest-value action: obtain the two independent completed reviews, report agreement before
  adjudication, resolve disagreements, then calibrate only confirmed harmful patterns on calibration.

## SALMA PERSONAL INTERVIEW TUTOR COMPLETE (2026-07-14, branch `codex/salma-coach-v1`)
- Implemented on a clean worktree from `origin/main`; production folder, live deployment, payment
  infrastructure, microphone acquisition, Gemini Live, Deepgram, interview WebSocket format, personas,
  timing, and fallback behavior were not changed.
- Salma is now an account-isolated, evidence-driven interview tutor under BrainGuide: exact bounded
  prescriptions, personal dosage/spacing/success gates, drill help, deterministic questions, verified
  between-attempt cues, idempotent speech acknowledgements, and live-interview retest recording.
- Ordinary-open speeches, repeated greetings, recruiter/employer/booking claims, and the fake mouth
  animation were removed. The portrait keeps natural blink plus a ring driven only by real audio.
- Masri fails closed: unapproved historical text cannot render or speak; runtime Masri TTS is rejected;
  German is the fallback until an owner-approved, hashed frozen phrase pack exists.
- Feature controls default off: `SALMA_COACH_MODE`, `SALMA_COACH_AI_ENABLED`,
  `SALMA_COACH_VOICE_ENABLED`, and `SALMA_MASRI_PACK_VERSION`; `SALMA_LIVE` remains the master switch.
- Verification is green: secret scan (311 files), lint, design lint, syntax (200 files), 393/393 server
  tests, production client build, 40-file artifact verification, and 320/375px no-overflow browser QA.
- No push, merge, public deployment, paid service, or production-data mutation was performed.

## 🎨 UI REVOLUTION SHIPPED + MOBBIN=PAID (2026-07-13, HEAD `69704ed` live-verified)
- **Mobbin MCP = PAID.** Post-restart its tools loaded, but the FIRST `search_screens` 402'd
  (`requires a paid plan`). Zero-spend → did NOT buy. Free alts told to owner: shadcn/ui MCP,
  Framelink Figma MCP, 21st.dev (tier), Context7 — but **Chrome+Playwright MCP** browsing live apps/
  free galleries beats paid Mobbin $0 (proven: opened the live app with it).
- **Emoji-chrome sweep DONE (`1461762`):** 🔊/🔈/🔇 → one shared `client/src/icons/AudioIcons.jsx`
  (Speaker/SpeakerQuiet/SpeakerMute; currentColor, aria-hidden, style prop) across 8 screens
  (Listening, Shadowing, SatzbauSchmiede, PressureLadder, BrainGuide, DailyTraining, App +
  SalmaTakeover `5eba995`). Build+lint clean; deploy-verified. Remaining chrome to hunt: ✕ text closes.
- **★ SALMA TALKS LIVE, APP-WIDE (`69704ed`):** ref-counted "is Salma speaking" signal broadcast from
  the salmaVoice funnel (salmaModel/salmaSpeak→playNative onStart/onEnd) → `subscribeSalmaSpeaking`;
  `SalmaPortrait` subscribes so her mouth moves in sync with real audio on EVERY card, no per-call
  wiring. Reuses the shipped 3-frame talk stack; reduced-motion strips it. Deploy-verified live.
  ⚠ Audio-sync gate = owner taps any 🔊 listen button and watches her mouth (like the clip ear-check).
- **STILL UNSOLD:** `salma-demo.mp4` (last session) — copy written, NOT posted. Distribution-first
  nag stands: a build-only session with that clip un-posted is not "done" per owner's standing order.

## 🎬 SALMA DEMO CLIP + 🎨 UI-UPGRADE WORKSTREAM + Mobbin (2026-07-13)
- **Demo clip (sent to owner, $0):** `salma-demo.mp4` 720² 10s — her living face (amplitude-driven
  mouth from the real audio + blinks) + her voice speaking the real `intro_welcome` line, warm-steered
  Gemini Kore (same as app), peak-normalized. Built offline via free key. Distribution copy (LinkedIn EN
  + WhatsApp masri-structure) handed over. Owner ear-check on the voice pending. Scripts in job tmp:
  genframes/genneutral/genaudio/buildclip/makepreview.mjs.
- **Mobbin MCP:** added `claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp`,
  owner authenticated → `claude mcp get mobbin` = ✔ Connected. ★ BUT its tools are NOT in this session's
  registry (ToolSearch "mobbin" → none) — mid-session MCP servers only expose tools after a Claude Code
  RESTART. Next session I'll have Mobbin's design refs.
- **UI-upgrade workstream (owner: "upgrade any UI via Mobbin, all free"):** design system is already
  mature+enforced (design-lint), so real level-up = Mobbin refs (post-restart). Found a concrete app-wide
  slop meanwhile: **emoji-as-chrome** (🔊 listen, 🔈/🔇 toggles, ✕ close) across Listening, PressureLadder,
  Shadowing, DailyTraining, BrainGuide, App, Feedback, SalmaTakeover — violates the icon law. Landed the
  machined stroke-icon PATTERN on the cold-open (`5eba995`: inline SpeakerIcon/CloseIcon, currentColor).
  NEXT: sweep the rest into one consistent icon set (App.jsx <Icon> not exported to siblings → export it
  or share inline set), preserving DailyTraining's playing/idle/muted semantic as icon variants. Then
  Mobbin-informed visual refresh, highest-leverage screens first (cold-open ✓ · paywall · auth/landing).


## 👁️👄 SALMA BLINKS + TALKS (2026-07-13, HEAD `5acb16c`, LIVE + verified)
Owner picked "b) make her blink/talk with frames." Delivered via **identity-preserving image EDITING**
(not new generation): fed the shipped `salma.jpg` back to `gemini-3-pro-image-preview` ($0 free key)
with minimal-edit prompts → **eyes-closed** frame + **mouth-open** frame of the SAME woman, plus a
matched **neutral** sibling (eyes-open, closed-lip smile). Cropped all 3 with ONE ffmpeg box (the
editor re-frames wider + ignores "keep crop", so a tight original won't align — regenerate a sibling).
**Alignment blend-proven** (`ffmpeg blend=average` 50/50 → ghosting ONLY at eyes/mouth, silhouette
clean → no pop). `SalmaPortrait` = 3-layer `<img>` stack, pure-CSS opacity keyframes: `salmaBlink`
(lids, always, slow loop) + `salmaTalk` (mouth crossfade, ONLY while `.talk`/speaking) + sway + glow;
reduced-motion strips all. Assets `client/public/salma{,-blink,-talk}.jpg` (~20KB each). VERIFIED:
build `5acb16c`==HEAD, all 3 frames HTTP 200 at exact bytes (20222/20539/17673); build+design-lint
clean. Self-contained preview `salma-preview-live.html` sent to owner for the motion ear-check (curl
can't prove motion looks good). Capability recorded → [[gemini-image-generation]] (editing section).
Note: closed-lip neutral is the new RESTING face (permanent teeth-grin reads "frozen"; she opens into
the smile when talking) — one-line swap back to teeth-smile base if owner prefers.

## 👩‍💼 SALMA REAL PHOTO AVATAR (2026-07-13, HEAD `ff48910`, live — blink/talk now DONE above)
Owner: "an attractive German young lady it should look like that, find me one." Illustration hit its
ceiling (SVG v1→v3), so pivoted to a REAL-looking face. Generated a **SYNTHETIC** portrait (no real
person → no likeness/impersonation risk) via `gemini-3-pro-image-preview` on the free no-billing
gemini-worker key (**$0**), picked best of 4, ffmpeg-cropped to the face + shrank 600KB→**18KB**
`client/public/salma.jpg` (Vercel serves `/salma.jpg`, verified HTTP 200 image/jpeg). `SalmaPortrait`
now renders the `<img>` (was inline SVG) with motion: gentle sway/breathe + a ring GLOW while
`speaking`; initials fallback on error; reduced-motion-safe. Verified: deploy `ff48910` + asset 200 +
build clean (couldn't grab a live in-card screenshot — browser tools were glitching, owner using
Chrome). Reusable $0 image-gen capability recorded → memory [[gemini-image-generation]]. ★ NEVER use a
real person's photo for a persona. Blink/talking-mouth on the photo = future (needs multi-frame gen).


## 🗣️👩 SALMA: NO-SYMBOL HUMAN VOICE + BIGGER ANIMATED FACE (2026-07-12, HEAD `7117117`, live)
Owner: "voice is ok, but she can't read * / symbols like Google read — talk like a GENUINE human" +
"make her face bigger, extremely attractive and moving." SHIPPED:
 • **Voice (`bb439f5` server)** — `stripNonSpoken()` on BOTH TTS paths (deterministic, foot-gun #17):
   emoji/arrows/bullets/markdown removed; em-dash + ellipsis → comma-pause (never "dash"/"dot dot
   dot"); slash → space (never "Schrägstrich"); €/times/abbrev expansion preserved. UNIT-PROVEN:
   `'*wichtig*'`→`'wichtig'`, `'Dativ/Akkusativ — … 🎉'`→`'Dativ Akkusativ, ,'`, Arabic scrubbed too.
   Non-ASCII regex built from char codes / `\p{}` (foot-gun #48/#49) — verified no NUL bytes.
   `DE_WARM_STYLE` now demands SPOKEN conversation, not narration.
 • **Face (`7117117` client)** — v2 SVG: bigger eyes + eyeliner + iris/catchlight, arched brows,
   fuller lips, blush, ears + stud earrings, refined hair. MOVING: always-on blink + gentle sway;
   `speaking` prop → talking-mouth loop (wired in home BrainGuide + cold-open); reduced-motion-safe.
   Sizes: home 38→46, cold-open 52. Screenshot-verified live (motion can't be screenshotted — CSS
   is build-verified + always-on). Photoreal still available if owner sends an image.
 Residual "predictable": her words are fixed owner templates (no LLM, El-Captain rule) + German until
 masri rows filled — true variety needs owner-authored line variants. Foot-guns #51 (manual-trigger =
 passive) + #52 (fix the path the user's STATE routes to) logged.

## 🎙️ SALMA VOICE→GEMINI + NEW FACE (2026-07-12, HEAD `0e1cff7`, live-verified)
Owner ear (after the "leads" fix): "still robotic, low voice, very predictable, very unhuman" +
"no beautiful face." DIAGNOSIS (foot-gun #52): her masri rows are EMPTY → she speaks the GERMAN
fallback = Deepgram Aura-2 `aura-2-kara-de`, the engine he did NOT pick, streamed WITHOUT the
loudness normalize (`tts-stream` dropped it on a wrong "Aura-2 is full-scale" assumption). My earlier
pcmToLoudWav loudness fix was on the MASRI path — never on the path he heard.
SHIPPED (`5285870` server + `0e1cff7` face):
 • **Voice** — Salma's German now runs on **Gemini** (his compare-page pick), SAME Kore voice as her
   masri, steered warm/human in German (`DE_WARM_STYLE`), normalized loud (pcmToLoudWav), cached→free.
   New voice id `salma-de` → `geminiGermanTTS`; wired in media-ticket + tts-stream + salma plan-gate
   exemption; client `SALMA_VOICE_DE='salma-de'`. Deepgram stays the BOSS voice (unchanged).
   PROVEN LIVE (authed fetch): media-ticket 200, tts-stream 200, **audio/wav** (Gemini, not Deepgram's
   audio/mpeg), RIFF, 417 KB → engine switch is deterministic. "Human enough?" = OWNER'S EAR (hard-
   refresh → home greeting). ESCALATION if not: ElevenLabs Yasmine (approved, Egyptian, multilingual;
   needs ELEVENLABS key + USE_ELEVENLABS on Render — his call, cached→~free for fixed lines).
 • **Face** — `SalmaPortrait` CSS blob (dot eyes + geometric mouth) → self-contained inline SVG:
   warm woman, framed dark hair, eyes w/ catchlights, gentle smile, blue blazer; viewBox scales
   34–96px, $0. Screenshot-verified in preview AND live on the home. Photoreal = owner sends an image.
NOTE: her WORDS are still German until owner fills masri rows (unchanged). "Predictable" is partly
structural (fixed owner templates, no LLM) — real variety needs owner-authored line variants.

## 🔊 SALMA NOW LEADS — no longer passive (2026-07-12, HEAD `073f5f8`, deploy-verified live)
Owner (lived): "Salma's voice is extremely slow, passive, doesn't guide through the app, waits for me
to click, total rubbish." ROOT = foot-gun #51: her home guide (`BrainGuide`, "THE FATHER LEADS")
called `speakSalma` ONLY from the 🔊 `onClick` — she NEVER spoke on her own → a silent card you click
through = passive by construction. Also: cold-open was a click-through wizard parking on "Weiter";
first line often autoplay-blocked + cold per-beat round-trip = "silent + slow." FIXED (`073f5f8`,
client-only → Vercel):
 (1) **BrainGuide** — proactive `useEffect` greets + directs OUT LOUD the moment the directive loads,
     ONCE per page-load session (module flag `greetedThisSession`), autoplay-safe (silent if blocked,
     🔊 still works), cleanup stops speech on unmount so she never talks over a launched drill.
 (2) **SalmaTakeover** — pure-narration beats AUTO-ADVANCE on her own voice (onStart-gated: if
     autoplay blocked her she waits for the unlocking tap instead of silently rushing); decision/input
     beats still wait for the human. Plus prefetch+warm her OPENING line on mount.
PROVEN LIVE (read-only, fresh tab sharing owner's login, his tab untouched): build `073f5f8` live,
`loggedOut:false`, home renders her BrainGuide card, and on plain load with ZERO interaction from me
`/api/media-ticket` + `/api/tts-stream` BOTH fired (`proactiveMediaTicket:1, ttsStream:1`) = she
initiates speech herself. Her words stay GERMAN until owner fills masri rows (masri-first arch
unchanged; I never author masri). Owner's device = final gate: hard-refresh → home → she speaks ~1-2s
unprompted (the app-open tap unlocks audio). Cold-open auto-advance is code+build-verified, not seen
in trigger context (owner has `omni_salma_seen:1` → never sees cold-open again; a fresh signup shows it).

## ✅ GOD-VERIFICATION LEDGER (2026-07-12 night, HEAD `6b71177`) — what is PROVEN vs build-only
PROVEN LIVE (seen/measured): (1) Übungen CULL — home page-text shows exactly 5 tiles, Druck-Leiter +
Video-Lektionen GONE. (2) Salma masri voice END-TO-END from the real client origin (owner's own
acct): media-ticket 200 → tts-stream 200 · audio/wav · 92,730 B · RIFF header. (3) Fresh pre-trial
acct masri (the 402 fix): media-ticket+tts-stream 200. (4) Beacons gate_b1_yes/gate_b1_no/ritual_done
→ 200 (whitelist correct). (5) Salma home card + notes + KARIM pipeline + 🔊 render. (6) Deploy
stamps == HEAD; import-load of changed server modules OK; build/design-lint/german-check/node --check
clean. (7) Ritual async voice-cleanup traced safe (stop() suppresses the onEnd that starts the
fragment → no double-voice/leak). BUILD+CODE-VERIFIED, NOT SEEN in trigger context (honest gap):
B1 landing admission bar · cold-open B1 GATE question · correction-ritual card + homework order —
all render via the SAME salmaLine path proven live on the home card; unseen only because (a) owner's
`bpo_token` is a blocked sensitive key → can't log him out+restore to reach logged-out/fresh state,
(b) ritual/homework need a full completed interview. CLOSE THEM: any fresh signup shows the landing
bar + gate immediately; one real interview shows the ritual. Owner acct `alhassanmaarouf8@gmail.com`
stays logged in on the test browser (untouched).


## 🔥 SALMA'S EGYPTIAN VOICE + FULL-JOURNEY LEADERSHIP (2026-07-12 night) — `5c53826`+`2497997`+`334abb1`
Owner order: "Salma leads the WHOLE experience with FULL Egyptian masri." Shipped: (1) server voice
id **`salma-masri`** → Gemini-TTS `gemini-2.5-flash-preview-tts` steered to Cairo masri (the engine
the OWNER'S EAR picked over Azure/ElevenLabs on the Sara compare page — see `voice-demo-factory`
skill; owner tonight: Azure is out, Gemini in) behind the SAME media-ticket/tts-stream cache;
Arabic-safe text cleaner (no German expansion); no-key → 503 → client silence law; **smoke-proven
locally HTTP 200, 2.0s audio in 3.1s** (Render already has GEMINI_API_KEY — zero owner steps).
(2) client **`salmaVoice.js` = ONE brain for her voice**: any salmaCopy line whose OWNER-AR `ar` is
filled is spoken MASRI in BOTH UI languages (his "full masri" rule); empty ar → her German kara
voice (never silent). All 5 call sites refactored (cold-open beats+replay, home notes w/ German-
directive dePrefix, rank ceremony, paywall auto+replay); ar-mode silence gates REMOVED. (3) She now
fronts the **drills** (Tägliches Training handoff strip + spoken intro/sign-off) and does a
**debrief follow-up after every interview** naming progress.nextBoss (skips when the rank ceremony
speaks). Reminders were already hers (`Die Arena · Salma`, other session). 4 new copy keys → owner
sheet regenerated (**135 slots**, 47 Salma rows in salmaCopy). ⚠ STILL OWNER-GATED: the 47 masri
lines (docs/owner-ar-sheet.md) — the moment ANY row is filled+deployed, that line SPEAKS masri.
⚠ Voice>text rule: de-UI users HEAR masri once rows fill while reading German — intended (owner's
explicit demand); revert = the `ar =` line in salmaVoice.js composeSalmaSpoken if his ear objects.
★★ 402 DISCOVERY (`c47db50`+`c5b1283`): trial clock starts at FIRST interview (consumeFreeFight) →
fresh accounts had drillsUnlocked=false → Salma's voice tickets 402'd → her COLD-OPEN was
server-silenced for every new user (and her paywall pitch after expiry), hidden by the client
silence law. Fix: `salma:true` tickets (her 2 voices only, ≤320 chars) bypass ONLY the plan gate.
PROBE ACCOUNT (replaces dead probe-0711): `alhassanmaarouf2+salma0712@gmail.com` /
`Probe-Salma-2026!x` — EMAIL-VERIFIED via Gmail-in-Chrome (search the inbox for the ?verify= link;
Brevo mail takes ~60–90s). Signup body = {email,password} only now (no WhatsApp field).
★★ B1+ REPOSITIONING WAVE (`37904c3`+`036864e`+`aa859b9`, all live-verified): owner law = customer
is B1 aufwärts ONLY ("those realistically have any chance of working"), Harvard/selectivity framing
per his order. Shipped: landing ADMISSION BAR (AB B1 · AUFNAHME NUR MIT NIVEAU, under CTA) · Salma's
DOOR QUESTION opens the cold-open (gate beat: B1+ → in; below → dignified turn-away, door open,
beacons gate_b1_yes/no live-tested 200) · below-B1 honest verdict line after screening · EXPERT-TEACHER
HOMEWORK ORDER (Wochenfokus footer = dose 15min×2 + exit <5 measured Grammatik-Fehler + unlock
"dann buche ich {boss}") · CULL: Druck-Leiter + Video-Lektionen tiles removed from Übungen
(replacements are better: real interview trains pressure; passive slides ≠ speaking — overlays
stay wired for prescriptions). Masri voice LOUDNESS fixed `37dbd44` (pcmToLoudWav on Gemini PCM;
owner: "very low, robotic" — robotic was the German-text smoke confound; fair normalized sample
with his approved Sara greeting sent for ear-check). Owner sheet now 149 slots.
★ KORREKTUR-ZEREMONIE shipped (`b71ab3d`+`e4b8590`+`7b2dda4`, expert-teacher doctrine #1 — a 25-year
DaF teacher's signature move, owner had him live in the room 07-12; NAME NEVER USED — owner order):
after any interview with a LanguageTool-verified fix, Salma chains follow-up → ritual prompt →
MODELS the corrected fragment (salmaModel, kara+salma:true), candidate repeats ALOUD, taps "Laut
gesagt" (self-reported, no fake verification), closing note "morgen im Training" is TRUE (fights
addItem→SRS→Tägliches Training). Beacon `ritual_done` whitelisted. THE EXPERT DELIVERABLE: full
10-gaps + 10-protocol answer with dosages/exit-criteria lives in the 07-12 conversation — REAP HIS
CORRECTIONS (dosage numbers, A2→B1 grammar order, strike-list) + a testimonial ask (an anonymized
«Geprüft von einem DaF-Lehrer, 25 J. Erfahrung» — never the real name) before building v2
(ASR-checked repeat, Prüfungstag weekly re-level, criterion boss gates, error-rate hero stat).

## 🔥 MAKE-IT-COOL v2 EXECUTION (2026-07-12 evening) — items 1+0+5a LIVE; plan approved for the rest
Owner approved the panel-synthesized plan (`~/.claude/plans/delegated-puzzling-stallman.md` — READ
IT before continuing; north star: tailored genuine progress × peak entertainment). SHIPPED+VERIFIED:
(1) `fa9c23a` damage numbers/SERIE re-plugged (10560f1 had falsed them; tuned 34px/1.6s, SERIE from
×3, comboBest now rendered in debrief); (0) `033ac3c` LANDING REDESIGN — animated arena preview
(CSS 9s fight loop, movement screenshot-proven, 8/10) + 6-opponent ladder strip, design-lint fully
clean; (5a) `78b55ca` SALMA SPEAKS — aura-2-kara-de (unclaimed voice) through the drills'
media-ticket/tts-stream cached path, silent-fallback, beat-synced in SalmaTakeover.
**REMAINING (approved, in order): item 2 REVANCHE loss flow (DER MOMENT quoted + rematch hint in
START_FIGHT) · 3 fight ritual (briefing w/ declared scrutiny, ENTSCHEIDUNG hold, NÄCHSTES-MAL
trailer) · 4 share-cards content recode (conquest/streak/Einladung, tier-gated) · 5 portrait
(stylized illustration, 3 Gemini-free candidates → owner picks) + Salma copy pass (mood variants,
per-boss briefings from impresses/annoys, booking branches by assessment tier) · 6 rank-up ceremony
(needs maxRank persistence — ranks decay on rolling-5!) · 7 comeback architecture (Salma Termin
owns the push; state-keyed SW pool via postMessage; lapse auto-quiet) · 8 dossier Zertifikat +
Akte-Nr (candidateNo at createAccount) · 9 paywall de-stack · 10 die-Arena spoken name. CUT (panel
unanimous): leaderboard strip, photoreal headshot, typing fake, glow/beam chrome, score/100 on
shareables.**
⚠⚠ ANOTHER SESSION IS LIVE ON THIS TREE **rewriting auth**: email verification now gates signup
(10afbc6+18dd64d+381213d Brevo SMTP), old test accounts WIPED (probe-0711 login = invalid_credentials
→ every future Playwright pass must create fresh accounts AND handle the verification step), it
pushes between my commits — `git fetch` before EVERY edit, stage by name. Logged-out landing fires
6 useless 401 calls (leaderboard/progress/billing/brain/auth-me/placement) — small cleanup candidate.

## 🔥 FINISH-EVERYTHING WAVE (2026-07-12, after Salma) — `9e84bf9`, ALL Playwright-verified live
Owner: "finish everything before you come back." Shipped+verified in one wave: (1) **WebView
signup BLOCK** (Messenger/IG browsers: login ok, account-creation blocked + copy-link escape —
closes the stranded-token residual); (2) **InstallCard** PWA prompt (Android one-tap via captured
beforeinstallprompt + iOS A2HS hint — installed app = exempt from the 7-day iOS storage wipe);
(3) **Salma pipeline board** (6-node interviewer ladder + next-booking line); (4) **rival note**
(real weekly leaderboard, masked); (5) **Bewerbungs-Dossier** (FORTSCHRITT → DOSSIER → printable
measured-evidence one-pager, nothing promised). New beacons whitelisted (inapp_signup_blocked,
pwa_*). Verified: fresh signup regression clean (normal Chrome unaffected), console 0 errors.
Owner-only remaining: masri fill + optional voice clips + her name. Deferred eng: per-user push
text (payload encryption).

## 🔥 SALMA THE RECRUITER LIVE (2026-07-12) — 4 commits `693e980→80e44ee`, all god-pass verified
Owner's guide-woman idea + placement-cold-open fused (approved plan
`~/.claude/plans/delegated-puzzling-stallman.md`): the app = Salma's recruitment agency. LIVE:
(1) `693e980` server GET/POST `/api/guide/profile` (typed name outranks STT, goal enum, idempotent
salmaIntroAt); (2) `8e391a9` BrainGuide = her card + file notes (topWeakness finally surfaced +
honest trial days); (3) `98cfc94` `SalmaTakeover.jsx` cold-open — once/account (server flag,
cross-device proven), welcome→name/goal→screening(=free assessment)→her verdict (real level/focus/
own-words quote)→books Yasmin at measured level; fail-open, kill switch `SALMA_LIVE` (App.jsx
~:104); (4) `1ffdcf9`+`80e44ee` salma_* beacons whitelisted (they 400'd silently — new beacon
events ALWAYS need server/funnelBeacon.js ALLOWED) + paywall fronted by her honest line (verify
pass caught+fixed a false "minutes spent" claim). ALL her words = `client/src/salmaCopy.js`
one-line owner templates (ar:'' slots, in docs/owner-ar-sheet.md; NO LLM ever — El-Captain law).
`docs/SALMA-VOICE-SCRIPT.md` = 12 slot-free lines if owner ever wants her voiced ($0 until then).
**OWNER: (1) fill her masri (owner-ar-sheet §salmaCopy.js — 25 rows) + rename her if "Salma" isn't
the name you want (client/src/salmaCopy.js SALMA.name); (2) the cold-open is a 20-sec screen
recording = your best FB ad yet.** QUEUED NEXT (approved plan's post-v1): pipeline-board home ·
rival candidate (leaderboard) · voice clips · hire-readiness dossier export.
Same session, earlier: arena spotlight beams `be11ebf` (bg finally non-boring, 7/10 phone probe) +
flying damage numbers `dd78f41` + auth cross-device verification (server clean; residuals =
Messenger-gate bypass strands tokens in WebView sandbox · iOS ITP needs an A2HS prompt).

## 🔥 VERTEX AI TRANSPORT BUILT (2026-07-11) — commit `3d4e1bb` LOCAL ON MAIN, NOT PUSHED
Owner's goal: Gemini Live bills the **$300 GCP free-trial credit** (project
gen-lang-client-0719205380, credit 100% intact, expires **Sept 26**) instead of his card.
DONE+PROVEN locally: gcloud installed+ADC (alhassanmaarouf2), aiplatform API enabled, $250 budget
alert live (`08823d75`), and the code: `server/vertexToken.js` (SA-key→OAuth on Node crypto, zero
deps) + Vertex WS transport in geminiLive.js/proxy + cred gates in server.js/wsManager.
Vertex live model = `gemini-live-2.5-flash-preview-native-audio-09-2025` (probe-verified; AI-Studio
`-latest` alias 404s on Vertex). Proof: `server/vertex-proof.test.mjs` PASS (74KB audio,
"Vertex funktioniert."). Inert without env vars — API-key path unchanged.
**REMAINING (blocked on owner, in order):** (1) approve `git push origin main` (deploys both);
(2) run the 2 gcloud commands to create the `omni-vertex` service account + key (permission
classifier blocked me — exact commands in the session report); (3) Render env: secret file
`omni-vertex-key.json` + `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/omni-vertex-key.json` +
`GEMINI_USE_VERTEX=1` (TYPE, don't JS-inject) — GEMINI_API_KEY may stay as fallback but Vertex
wins the gate only via GEMINI_USE_VERTEX; (4) raise GEMINI_BUDGET_USD (still $5); (5) probe one
prod fight (`gemini-gate` log line now prints `vertex=`).

## 🔥 COST MEASURED + REPRICING SHIPPED (2026-07-11) — FINAL `4fba81a` VERIFIED LIVE (owner-tuned: Basic 999 = 15 min/day as 2×7.5 interviews · Elite 1999 = 30 min/day as 4×7.5; supersedes same-day 3c7cd49 599/1499)
Owner ordered: test 3 full interviews end-to-end, get cost/interview, then redo prices/features/
trial (rule: every paid plan = daily HR-interview quota + unlimited drills; approachable vs
German-course budgets). MEASURED on prod (probe-cost.mjs, edge-tts varied German answers, Gemini
native audio, 0 fallback): **$0.022–0.025/min ⇒ 8-min interview ≈ $0.19 ≈ 9.6 EGP**; dense answers
end the 3-stage fight in ~2 min. SHIPPED: plans sold as FULL daily interviews — Basic 1299→**599**
(1×8-min/day), Elite 2999→**1499** (3/day + Ziel-Stelle + Neu-Einstufung), yearly = 10×monthly;
MAX_FIGHT_MS 7.5→8 min; entitlement exposes dailySessions; paywall/home copy = interviews not
minutes; SUB_AR masri untouched (still true with m=8/24). Trial mechanically unchanged (3 days at
Basic = 1 interview/day + drills; post-trial one-time free fight stays). Verified live: health +
Vercel meta = 3c7cd49, billing/status serves 599/1499 + dailySessions 1/3, fresh-signup
entitlement dailySessions:1. Full economics: memory `bpo-cost-per-interview-repricing-0711`.
**⚠ OWNER ACTIONS: (1) GEMINI_BUDGET_USD=5 = ~26 interviews/month for the WHOLE app then paid
users silently drop to the $0 robotic path — raise it on Render (type real keys; ~$6/subscriber/mo
worst-case). (2) 50% offer auto-expires tonight 23:59 Cairo; until then it discounts the NEW bases
(299/750). (3) Masri pass on paywall copy invited (OWNER-AR slots unchanged).**

## 🔥 ELITE PASS: HOME (2026-07-10) — `26eb853` VERIFIED LIVE (Vercel stamp + Guardian green + fresh prod screenshot, 0 page errors)
Owner re-issued THE ELITE PROMPT ("my bpo app"). Surface shipped: home readiness ladder
(RankLadder) de-arcaded — killed glowing rank text, idle-pulse dot, glow bars, the "SO NAH! 🔥"
near-miss flasher, 🏆/🎯 chrome emoji, 9px micro-caps, orange-as-second-accent, and the
INTERVIEW-BEREITSCHAFT/Rekrut label collision at 390px. Blue/neutral instrument now; the home's one
orange = the CTA. Also fixed: scripts/qa/screenshot.mjs --signup was dead (probe-rot: labeled form
+ required WhatsApp; selectors now type-based). Enforcement history + parked items (shadow-action
glow token, arcade rank vocabulary) recorded in design-system SKILL.md.
**OWNER HIT THE RESET WALL LIVE ("nicht verfügbar" + rage): reset is DORMANT because SMTP_USER/
SMTP_PASS are still unset in Render. OWNER STEP: create the Gmail App Password
(myaccount.google.com/apppasswords, needs 2FA on) → set SMTP_USER=alhassanmaarouf2@gmail.com +
SMTP_PASS=<16-char app password> in Render env (TYPE with real keys — JS-injected values don't
save) → verify ONE real reset mail end-to-end. Craft pass queue after: debrief, paywall.**

## 🔥 OWNER RAGE: "boss waits for my words / fixes never stick" (2026-07-10, night) — ANSWERED WITH PROOF
He re-reported the transcript-gated feel + "you claimed voice-to-voice is separated 10^N times".
FACTS ESTABLISHED (all curled live): Render build 9c434ac (includes ff48fc8 instrumentation +
transcriptGuard — the fd9e042 verify-live is now CONFIRMED); /health geminiLive:true; gate is
open for ALL accounts (geminiEmailAllowed = () => !GEMINI_LIVE_DISABLED, wsManager.js:57); funnel
today 16 gemini_fight / 0 gemini_fallback → his fights DO run native voice-to-voice; transcripts
are display-only on that path (packet proves it line-by-line). /api/diag/latency count=0 because
Render restarted ~17:50Z (in-memory ring wiped) — NOT because instrumentation is missing.
DELIVERED: `docs/CHATGPT-REVIEW-turn-latency.md` — self-contained external-review packet (owner
asked to review "my code" with ChatGPT): full turn-taking chain (geminiLive.js, proxy, wsManager
gemini handlers, client dispatch, GeminiVoicePlayer) + measured facts + 4 sharp review questions.
NEXT PROOF STEP: owner hard-refreshes (Ctrl+Shift+R — stale tab = old code, the known trap), runs
ONE fight, then `curl /api/diag/latency` → his real per-turn gemini-live gaps. If p95 ≫ 2s →
region/model investigation. The felt 1.34–1.57s = Gemini generation; $0 floor unless masked better.

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
