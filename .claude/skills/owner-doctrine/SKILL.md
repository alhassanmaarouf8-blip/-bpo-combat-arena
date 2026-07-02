# owner-doctrine — predict the owner's verdict before he gives it

**Read this before building or changing ANYTHING learner-facing.** It is the distilled pattern
of every complaint and every praise from the owner's live testing (2026-06 → 2026-07, ~25 days,
~40 owner messages). The purpose is prediction: if your change violates a law below, the owner
WILL report it as a bug — usually within one day, usually angrily, and he will be right.

## The 8 laws (each one is a real, repeated complaint class)

1. **NOTHING ROBOTIC, EVER.** No browser speechSynthesis anywhere — native voice (playNative /
   Aura-2 / ElevenLabs) or *silence*. This covers timbre AND delivery: no essay-read narration,
   no polished written German where a human would speak ("Gut, das reicht mir dazu…" not
   "Des Weiteren möchte ich anmerken…"). Time-stretch below ~0.8× reads as robotic too.
   *History: Shadowing voices, Video-Lektionen narration, Hana's funnel jumps, "remove all
   unhuman voices across the app — shadowing is bullshit because of that."*

2. **NEVER SHOW THE LEARNER SOMETHING FALSE.** No invented feedback, no unverified "correct"
   answers, no blaming the learner for a system failure (cut-off turn, STT mishear), no
   fabricated metrics, no cherry-picked averages. If the data is thin: say less, honestly.
   Gates already exist — use them: `turnQuality.js` (truncation/confidence), langGuard,
   `looksLikeTrustworthyCorrection`, deterministic graders only (a model never judges
   right/wrong).
   *History: the false "unter Druck eingebrochen" verdict, the broken "correct" Sag-es-richtig
   sentence (owner enraged), "Pariethon" quoted back, fake-looking scorers.*

3. **LANGUAGE PURITY IS ABSOLUTE.** German fields contain German. Arabic fields contain Egyptian
   Arabic or German — never phonetic-Arabic German ("فيهلهيندي"), never foreign scripts. And the
   builder NEVER authors masri — every Arabic string is an OWNER-AR slot the owner fills (reusing
   an existing approved string verbatim is fine). German terms with no natural Arabic stay German.
   *History: CJK glyphs in Hör-Check and Alhassan, "兄", "aku", the transliteration rage.*

4. **EVERYTHING VISIBLE MUST EXPLAIN ITSELF.** Every drill has a one-line DrillIntro (why it
   exists, how it compounds). Every number/line/strikethrough must be decodable by the learner
   without asking. If you can't explain a UI element in one sentence, it's clutter — remove it.
   *History: "is Sag es richtig a pure hallucination?", the confusing strikethrough, "I need the
   logic behind everything clear for the user."*

5. **ALL SURFACES ONE ORGANISM.** The interview finds the weakness → the debrief names it →
   the drills/lessons train exactly it → the next interview re-tests it. Any new surface must
   read from and write to that loop (hireReadiness / drill-event / SRS). A feature that doesn't
   know what the interview learned is incongruent — he sees it immediately.
   *History: "There has to be real intelligence and congruency between the drills, the interview,
   the feedback — everything must work in harmony."*

6. **SHARP, PERSONAL, SPARSE FEEDBACK.** One verdict, ONE next step — never a million advices.
   Quote the learner's own (verified, non-truncated, confident) words. Metrics need a matrix that
   means something (tempo × accuracy × relevance), not a single vanity number.
   *History: "never a million advices", the Flow-Drill WPM-only complaint, debrief
   progressive-disclosure.*

7. **ZERO SPEND. DETERMINISTIC. SERVER-SIDE.** No new paid APIs, no new dependencies without
   need, prefer curated pools + deterministic checks over model calls, prefer server-testable
   over client-feel. The only owner-approved paid exception: ElevenLabs interview voice.
   *History: "$0 forever" repeated ~15×; distrust of model-driven leveling — rules decide, the
   model conducts.*

8. **HIS DATA, HIS CONTROL, REAL NAMES-NOT-EMAILS.** Anything the app knows, the owner can see
   (admin), and the public sees only what's honest + privacy-safe (names, never emails). Never
   name an employer/company anywhere.
   *History: comp-access + admin buildout, "بلاش email عشان خصوصية", the no-employer-names rule.*

## Pre-ship checklist (60 seconds, run mentally against your diff)

- [ ] Does anything play audio? → playNative-family only, stop handle kept, silenced on unmount.
- [ ] Does an LLM generate learner-visible text? → langGuard gate (curated fallback) or
      scrubStringsDeep/scrubForeignScript (one-of-a-kind text) at the parse boundary.
- [ ] Did I write ANY new Arabic? → strip to OWNER-AR slot unless verbatim-reused.
- [ ] Does a learner see a number/verdict? → deterministic source, honest when thin, never
      blames a truncated/mis-heard turn.
- [ ] New UI element? → DrillIntro/one-line purpose, design-system SKILL obeyed (blue+orange,
      ONE orange per screen, Inter, 44px targets), explains itself.
- [ ] Does it join the loop? → reads weakness / writes drill-event where it plausibly should.
- [ ] Any new cost? → must be $0 (ElevenLabs excepted).
- [ ] Names not emails; no employer names; nothing fabricated.

## Prediction duty (the recursive part)

When you finish a task, spend one minute predicting the owner's NEXT complaint in the area you
touched (use the 8 laws as the lens). If the fix is <30 min and clearly inside the laws, do it
in the same change. If bigger, add a `QUEUED` item to ROADMAP.md with a "Why (predicted…)"
line — the nightly builder will pick it up. This file is why the app improves while he sleeps.
