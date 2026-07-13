# OMNI-PERFORM — 7-Persona Lite Audit (2026-07-02)

**Method note (read this first):** Token-reduction directive from the owner cut this down from the
originally-planned full live/desk audit. This pass was done by ME directly (no subagents, no
Workflow, no web research) using existing project knowledge already in context plus ONE live grep
against the real repo. Verdicts below are **informed hypotheses, not observations** — treat
accordingly. Nothing here touched the live app or any paid API ($0, confirmed).

**One real finding worth flagging immediately:** the original audit brief stated panelscorer.mjs is
"NOT wired into the live grade path." A quick grep of `server/websocketManager.js` shows
`gradeTranscript` imported from `scoring/panelscorer.mjs` and actively called (`gradeSource:
'panelscorer'`, with a try/catch fallback to `gradeUnavailable` on failure). **This looks wired in
now** — either the premise is stale or there's a live/fallback split I didn't chase down. Worth 5
minutes of your own confirmation before trusting either claim.

## The 7 personas (compressed)

| # | Name | CEFR self / real | Prior tools | Urgency | Anxiety/style |
|---|------|----|----|----|----|
| 1 | Mariam, 24 | B1/B2 boundary / A2+B1 speaking | Goethe B1 cert (frozen speaking) | 30-day, family pressure | moderate anxiety, needs visual structure |
| 2 | Youssef, 29 | claims B2 / actually A2 | Duolingo + YouTube, self-taught, no real conversation ever | 6mo exploring | overconfident, wants speed, no hand-holding |
| 3 | Hana, 22 | solid B1 | evening classes | 3wk, internal move at current BPO job | fine with spoken correction |
| 4 | Omar, 34 | B1 pushing B2 | Langua + iTalki (burned by cost/pace) | 30-day, post-redundancy | skeptical of AI tools, low patience |
| 5 | Nourhan, 26 | genuine B2 | Goethe B2 cert | 6mo, comparing vs DAAD scholarship | freezes under pressure, self-critical |
| 6 | Ahmed, 20 | true A2 | ChatGPT voice mode ("too easy, never corrects me") | low, backup plan | overwhelmed by UI complexity |
| 7 | Salma, 31 | B1 (real spoken practice via Discord exchange) | Memrise MemBot (hated the no-memory-across-sessions reset) | 30-day, sole income | wants max efficiency, zero tolerance for untracked mistakes |

## Per-persona verdicts (Track1 = closer/further/no_change to hireable; Track2 = feedback reads earned vs templated)

- **Mariam** — Track1: **closer**. The format (forced spontaneous production) directly targets her real gap (cert without speaking fluency). Track2: **uncertain** — depends on whether the panelscorer-wiring finding above holds; flag, don't assume.
- **Youssef** — Track1: **closer**. Real B2-pitched demands should deflate his overconfidence with concrete corrected output — *if* the correction pipeline is trustworthy (project memory shows a real fix here: `turnQuality.js:looksLikeTrustworthyCorrection` was added after a stutter/truncation bug shipped a broken "correct" sentence). Track2: contingent on that fix holding in production.
- **Hana** — Track1: **closer**, best product-market fit of the 7. BPO-specific scenario roleplay is the exact differentiator Langua users cite as valuable over generic conversation apps, and it's native to this app.
- **Omar** — Track1: **further, conditionally**. His skepticism means any surviving known UI bug (duplicate render / character mismatch) confirms his priors fast and he churns. Highest-risk persona for the app's *stated* known-bug list — status of those bugs wasn't re-verified this pass.
- **Nourhan** — Track1: **no_change → further**. This is the Yoodli-documented practice-vs-performance transfer gap: her language is fine, her blocker is stakes-anxiety, and low-stakes AI practice structurally may not transfer to real interview stakes regardless of app quality.
- **Ahmed** — Track1: **uncertain, risk of further**. If placement/difficulty calibration drifts the way the seed research flags for ChatGPT-as-tutor (mismatched level content), a true A2 could get steamrolled by B1/B2-pitched drills — this needs the owner to verify `Assessment.jsx`/`placement.js` actually gates a true A2 down correctly.
- **Salma** — Track1: **closer**, second-best fit. Her one explicit ask (don't reset my mistakes every session) is precisely what the SRS/weak-points system already exists to solve (project memory: Sag-es-richtig SRS drill, `srs.js`, admin weak-points drill-down) — should be the strongest differentiation moment vs her prior tool (Memrise).

## Pattern clusters, ranked by threat to the actual hiring KPI (not by ease of fixing)

1. **Performance-anxiety / practice-to-performance transfer gap** (Nourhan) — the single biggest ceiling on "does this get someone hired," because no amount of app polish closes it by design. Structural, not a bug.
2. **Placement/difficulty-drift risk for true beginners** (Ahmed) — unverified this pass, but if real it actively damages the users least equipped to self-correct. Directly transferred from the ChatGPT-tutor research pattern, not yet checked against this app's actual placement code.
3. **Feedback-credibility uncertain at scale** (Mariam, Omar) — I did not sample actual generated feedback *text* this pass. The panelscorer-wiring discrepancy above makes this an open question, not a settled one either direction.
4. **Known-bug status stale/unclear** (Omar) — the audit brief's "known issues" list may itself be partly out of date (see panelscorer finding). Needs your 5-minute confirmation, not more of my guessing.

## Head-to-head (grounded in prior research already in context + this pass's one finding — not re-researched)

- **vs Langua**: wins on BPO-scenario specificity (Hana's case, a documented Langua-user-valued gap this app fills natively). Unverified whether Langua's case/gender correction system is more mature than this app's current correction pipeline.
- **vs Yoodli**: shares Yoodli's core unsolved problem (practice-vs-performance gap) — no edge either way there. Wins on domain specificity (German + BPO vs general interview coaching). Likely loses on polish/maturity given the app's own known-bug list.
- **vs ChatGPT voice mode**: wins on structure/scenario realism *if* this app's own placement holds (open question, see risk #2 above — ChatGPT's failure mode is exactly what's unverified here too). Loses on raw conversational flexibility by design (fixed scenarios vs open-ended).
- **vs Talkparty**: **not researched this pass** (skipped to save tokens) — genuinely cannot judge, not a placeholder "wins/loses."

## Cannot judge (say so, don't guess)

- Real employer response rates, interview pass rates, retention, whether actual Concentrix/Foundever recruiters rate trained candidates higher — no placement outcome data exists anywhere.
- Actual generated feedback text quality (earned vs templated) — not sampled this pass.
- Current live status of the 4 named known bugs (duplicate render, character mismatch, ElevenLabs integration completeness, lag points) — only panelscorer wiring was spot-checked.
- Any real human's actual emotional reaction — this is a desk exercise done by me directly, not observed personas.
- Talkparty comparison.
