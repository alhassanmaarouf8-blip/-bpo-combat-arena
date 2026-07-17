# OMNI-PERFORM cumulative adversarial journey — 2026-07-17

## Counting contract

- A defect counts only after a reproducible production path and expected-versus-actual evidence.
- QA-001–QA-148 and the A2/B2/C1 journey findings are the deduplication baseline.
- A returned fixed defect is a release regression, never relabelled as new.
- Preferences, unverifiable audio impressions, and multiple symptoms of one failure are not counted.

## Regression gate

The focused gate passed 51/51 before this run: typed-mode isolation, stage integrity, persona eligibility, tutor quota removal, drill-result persistence, evidence integrity, exact repair debt, spaced retesting, and transfer mastery.

## Newly confirmed defects

| ID | Severity | Surface | Production reproduction | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| QA-149 | P1 | Daily Training | Open `Tägliches Training` at 320px; accessibility snapshot still exposes every home control and focus remains on the background launch button. | Modal semantics, isolated background, focus inside. | No dialog, background remains operable. | Fixed locally by shared overlay contract. |
| QA-150 | P1 | Flow Drill | Open `Flow-Drill`; DOM reports zero dialogs, one background Satzbau button, and focus on the background Flow tile. | Same. | Same modal-isolation failure. | Fixed locally. |
| QA-151 | P1 | Listening | Open `Hör-Check`; DOM reports zero dialogs, background exercises exposed, focus on background tile. | Same. | Same modal-isolation failure. | Fixed locally. |
| QA-152 | P1 | Shadowing | Open `Shadowing`; DOM reports zero dialogs, background exercises exposed, focus on background tile. | Same. | Same modal-isolation failure. | Fixed locally. |
| QA-153 | P1 | Spoken Review | Open `Sag es richtig`; DOM reports zero dialogs, background exercises exposed, focus on background tile. | Same. | Same modal-isolation failure. | Fixed locally. |
| QA-154 | P1 | Sentence Builder | Open `Satzbau-Schmiede`; snapshot contains the drill plus the complete home and duplicate Salma regions. | One modal surface only. | Drill and home are simultaneously exposed to assistive technology. | Fixed locally. |
| QA-155 | P1 | Progress Dashboard | Open `Fortschritt`; zero dialogs, background exercises exposed, no meaningful focus entry. | Modal dashboard with focus inside. | Background remains exposed and focus is lost. | Fixed locally. |
| QA-156 | P1 | Pricing | Open `Preise & Pläne`; zero dialogs, background exercises exposed, focus remains on the background price CTA. | Modal pricing surface with focus inside. | Background remains exposed and operable. | Fixed locally. |
| QA-157 | P1 | Feedback | Open `Feedback geben`; zero dialogs and all background controls remain exposed. | Labelled modal with isolated background. | Feedback visually overlays but is not a modal to assistive technology. | Fixed locally. |
| QA-158 | P1 | Feedback rating | Accessibility snapshot exposes five nameless buttons. | Each rating announces its value and selected state. | Screen-reader users cannot identify a rating. | Fixed locally with labels and pressed state. |
| QA-159 | P1 | Feedback rating | Source and production snapshot show the five rating buttons have no content. | Visible rating symbols. | The rating controls are empty clickable areas. | Fixed locally by restoring visible stars. |
| QA-160 | P2 | Touch targets | Production measurement: feedback trigger 38px high and rating buttons are below the 44px target. | Core controls at least 44px. | Miss-prone touch controls on mobile. | Fixed locally. |
| QA-161 | P2 | Settings disclosure | Production measurement at 320px: `Optionen` is only 22px high. | At least 44px. | Miss-prone primary settings entry. | Fixed locally. |
| QA-162 | P2 | Interview settings | Interviewer and target-industry selects are only 36px high. | At least 44px. | Both key selectors miss the touch-target floor. | Fixed locally. |
| QA-163 | P2 | Feedback language | `DE` and `العربية` controls are only 21px high. | At least 44px. | Language selection is difficult on touch devices. | Fixed locally. |
| QA-164 | P2 | Debrief dismissal | `Verstanden` is only 40px high. | At least 44px. | Frequent dismissal action misses the target floor. | Fixed locally. |
| QA-165 | P1 | Evidence dossier | Open Dashboard → Dossier; zero dialogs, dashboard controls remain exposed, focus remains on `DOSSIER`. | Nested modal with dashboard isolated. | Two layers are simultaneously operable. | Fixed locally. |
| QA-166 | P0 | Evidence dossier truth | Row says `Geschätztes Deutsch-Niveau B2`; footer says `nichts ist geschätzt`. | Consistent evidence boundary. | Document contradicts itself. | Fixed locally. |
| QA-167 | P0 | Evidence dossier trust | Footer says `Verifizierbar unter omni-perform.vercel.app` but provides no verification route or code. | A real verifier or no verification claim. | Generic homepage cannot verify this document. | Fixed locally by removing the claim. |
| QA-168 | P2 | Evidence dossier German | A one-day streak renders `1 Tage`. | `1 Tag`. | Learner-facing grammatical error inside an application artifact. | Fixed locally. |

## Current honest count

- Newly confirmed in this journey: **20**.
- Requested target: 100 new, distinct defects.
- This document deliberately does not claim 100.
