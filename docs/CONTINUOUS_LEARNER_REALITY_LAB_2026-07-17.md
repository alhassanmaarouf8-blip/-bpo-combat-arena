# Continuous Learner Reality Lab — iteration 1

**Date:** 2026-07-17  
**Baseline:** `ce1c29d`; 700/700 server tests plus lint, design lint, secret scan, client build and artifact verification.  
**Deduplication baseline:** QA-001–QA-168 in `ADVERSARIAL_JOURNEY_2026-07-17.md`.  
**Browser evidence:** five simultaneous production tabs: learner home, second-device reload, entitlement modal, `?daily=1` PWA deep link, and 320px feedback/accessibility. Daily, Flow, pricing, PWA-deep-link, and feedback states were exercised concurrently.

## Compounding contract

The authoritative learner model may advance only from reliable Evidence Contract v2 sessions. A partial,
interrupted, thin, or ineligible v2 session may remain in history, but cannot manufacture mastery, move the
session count, redefine the latest trustworthy activity, or veto a later verified improvement. Improvement
requires durable completion, delayed matched retest, and novel-pressure transfer; later reliable regression
suspends the earlier conclusion.

## Distinct new defects

| ID | Severity | Exact state and reproduction | Expected / actual evidence | Root cause | Smallest safe fix + regression | Status |
|---|---|---|---|---|---|---|
| QA-169 | P1 | Deterministic learner ledger: turn 1 `zwei Jahre Erfahrung`; turn 2 `vor drei Jahren nach Kairo gezogen`. | Expected no contradiction; `findContradiction` returned a year contradiction. | Numeric memory keyed only by unit, not semantic axis. | Bind numbers to bounded axes (`work_experience`, `time_ago`, quantity); twin test plus true same-axis contradiction. | Fixed locally; production pending. |
| QA-170 | P1 | Empty callback ledger; note `Ich arbeite bei vodafone als Kundenberater.` | Expected employer history excluded; `pickCallback` returned the full line. | Employer filter depended on capitalization/form. | Case-insensitive employment-context filter; lowercase regression. | Fixed locally; production pending. |
| QA-171 | P1 | Sales/retention counterfactual twins: unsafe pressure vs explicit negation/`nicht nur … sondern`. | Expected only unsafe twin penalized; both twins were contradicted. | Negative rubrics matched substrings without bounded negation/contrast scope. | Scope-aware negative matcher; four twin regressions preserve genuine unsafe cases. | Fixed locally; production pending. |
| QA-172 | P0 | Correct server-graded drill; restart between evidence-receipt issue and redemption. | Expected durable/idempotent completion; process-local receipt map returns null after restart. | Verified receipt stored only in memory. | Persist atomic one-use receipt hash or grade+completion transaction; restart/double/wrong-owner/expiry tests. | Confirmed, not fixed in this batch. |
| QA-173 | P1 | Account A enables push; logs out; B logs in in same browser. | Expected B off and A detached; browser subscription makes B look on while server owner remains A. | Browser endpoint existence is treated as account truth; logout does not reconcile owner. | Account-bound status and atomic rebind/unsubscribe on logout. | Confirmed, not fixed in this batch. |
| QA-174 | P1 | Enable reminder state; activate new service worker. | Expected metadata retained; activation deleted `META_CACHE`. | Cache allowlist preserved only shell cache. | Preserve both caches; static release regression and mutation. | Fixed locally; production pending. |
| QA-175 | P2 | Push with `data.url='/?daily=1'`; click with open/closed app. | Expected task deep link; handler always navigated `/`. | Notification click target hard-coded. | Validate same-origin relative target and navigate/open it; release regression. | Fixed locally; production pending. |
| QA-176 | P1 | Cohort invite status request never settles. | Expected bounded offline/retry state; signup remains disabled forever. | No request deadline. | Composed abort controller with 12s ceiling; never-resolving test. | Fixed locally; production pending. |
| QA-177 | P1 | Retry cohort twice; newer valid response arrives before older invalid response. | Expected newest attempt authoritative; stale older response overwrote it. | No request generation/abort guard. | Monotonic request ID and stale-response suppression; source regression. | Fixed locally; production pending. |
| QA-178 | P1 | Billing status/intent/paid request on network blackhole. | Expected bounded reconciliation and retry; submitting state can remain forever. | Money-flow fetches have no deadline or commit reconciliation. | Bounded billing client and status reconciliation before retry. | Confirmed, not fixed in this batch. |
| QA-179 | P1 | Forgot/reset request on network blackhole. | Expected retry with fields retained; busy state can remain forever. | Recovery fetches have no deadline. | Bounded recovery request and `finally` cleanup. | Confirmed, not fixed in this batch. |
| QA-180 | P1 | Installed PWA offline; open `/?daily=1` or another query-bearing navigation. | Expected cached shell without caching query; direct fetch rejects to browser offline page. | Privacy bypass skipped both caching and shell fallback. | Network-only query request with navigation-only shell fallback; assert query never enters cache. | Fixed locally; production pending. |
| QA-181 | P1 | Arabic interface/Arabic-first landing under screen reader. | Expected `ar-EG`/RTL interface metadata; production root remained `lang=de`. | Static document metadata never followed interface choice. | Root language/direction effect; German content stays explicit German. | Fixed locally; production pending. |
| QA-182 | P1 | Active interview → typed mode → keyboard focus answer textarea. | Expected visible focus; production inline style removed outline with no replacement. | Native focus indicator suppressed. | Restore native focus and stable class; source regression. | Fixed locally; production pending. |
| QA-183 | P2 | Reduced-motion OS; cold first paint or Suspense load. | Expected stationary progress cue; production still spun slowly. | Reduced motion interpreted as slower animation. | Disable animation and retain static progress border; first-paint/Suspense regressions. | Fixed locally; production pending. |
| QA-184 | P0 | Two reliable v2 sessions improve, followed by an ineligible thin session with worse grammar; or only a partial v2 session. | Expected learner model uses reliable sessions only; actual all-session count/progression could advance mastery and set global regression. | `buildSnapshot` mixed authoritative evidence with raw session history. | Modern profiles use reliable sessions for navigation count, latest activity, mastery bootstrap and regression; legacy profiles preserve compatibility. | Fixed locally with two compounding regressions; production pending. |

## Not counted

- Mission Control may expose `READY_TO_APPLY` through a weaker written/session gate disconnected from
  delayed matched + novel transfer. The route exists, but authenticated feature reachability was not
  established in this run, so it remains a candidate rather than an inflated defect.
- Slow service-worker network-first fetch without a deadline remains a coverage gap until controlled
  reproduction distinguishes a true hang from browser/network timeout behavior.
- No consented anonymized spoken samples with two independent qualified ratings were supplied. The
  expert-gold software pipeline exists, but educational accuracy remains explicitly unproven.

## Honest count

- New distinct confirmed defects in this iteration: **16**.
- New defects fixed locally with regression coverage: **12**.
- Confirmed but intentionally unresolved in this batch: **4**.
- Previous journey defects: **20**.
- Cumulative newly confirmed across the two 2026-07-17 ledgers: **36**, not 100.

## Verification status

- Focused functional/regression tests: green.
- Mutation probes: 4/4 killed (semantic-axis collapse, negation-scope removal, reminder-cache deletion,
  unreliable-session progression).
- Full suite and production build: must pass after this document is written.
- Production verification: pending deployment; no claim of a live fix is made.
