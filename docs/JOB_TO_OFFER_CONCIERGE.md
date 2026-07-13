# Job-to-Offer Concierge Validation

## Purpose and boundaries

Validate whether active German BPO job seekers use and value a narrow candidate-side loop before
automating job discovery or mailbox access. The concierge simulates the proposed product with the
existing readiness and vacancy-training features plus a private ledger. It is not a recruiting service.

## Release interlock

Automated discovery remains off unless both `JOB_DISCOVERY_LIVE_ENABLED` and
`MISSION_CONTROL_CONCIERGE_VALIDATED` are explicitly enabled on the server. Missing, malformed, or
one-sided configuration fails closed. Set the validation flag only after the five-student decision gate
below has passed and its evidence has been recorded; switching it on is not a substitute for passing the
gate.

All Mission Control `on`/`beta` modes also require
`MISSION_CONTROL_SINGLE_WRITER_CONFIRMED=true`. The current profile store provides in-process
serialization but not cross-instance compare-and-swap. This attestation may be enabled only while one
application instance owns Mission Control writes. Missing or malformed configuration disables the
Interview Pass, Opportunity Copilot, targeted vacancy interviews, and discovery. A multi-instance
rollout requires a durable database transaction/CAS migration first.

- Exactly five students participate for up to 21 days.
- Participation requires explicit, recorded opt-in from each student. This protocol does not authorize
  outreach to recruit participants; the owner supplies already-consented participants or uses an
  independently approved in-app invitation.
- OMNI-PERFORM does not contact employers or recruiters, submit applications, sign in to job boards,
  scrape authenticated services, or send follow-ups on a student's behalf.
- Students review and submit every application themselves on the official employer or ATS page.
- No paid tools, discounts, fabricated proof, invented candidate facts, or employment guarantees.

## Candidate and opportunity gates

Admit only an adult candidate actively seeking an Egyptian German-speaking BPO/customer-service or
supported German remote role who can state their location/work authorization, availability, German
level, role preference, and experience. Do not collect protected characteristics.

For each student, manually inspect at least 30 current public vacancies and show no more than five
recommendations at a time. A recommendation must:

1. Be a demonstrable German BPO/customer-service vacancy on a current public official page.
2. Pass explicit hard-fit checks: role, German requirement, location/work mode, work eligibility,
   schedule, and stated experience requirements.
3. Show separate, explainable fit and readiness states. Incomplete readiness evidence is
   `MEASURE_FIRST`, not a rejection; the candidate always makes the final decision.
4. Be deduplicated by source, employer, role, and location, and be rechecked as open immediately before
   the official application page is opened.
5. Use only candidate-confirmed facts. Never generate experience, skills, availability, salary,
   credentials, or application answers.

When a student receives a genuine employer response, they may classify it manually or paste only the
minimum relevant excerpt. Record the confirmed category and date, then discard the raw excerpt. A
confirmed interview invite activates the existing private vacancy target and its preparation plan.

## Operating sequence

1. Record participant consent and a pseudonymous cohort ID; do not put names, emails, phone numbers,
   CV text, or recruiter messages in this ledger.
2. Complete the Candidate Passport using facts confirmed by the student.
3. Inspect at least 30 public vacancies and log every exclusion reason internally.
4. Present up to five explainable recommendations; the student marks each relevant or not relevant.
5. For a chosen role, open the official destination. The student completes and submits it; afterward,
   they explicitly confirm `applied` in the tracker.
6. Check in only through a separately consented in-product/reminder channel. No employer contact and no
   repeated marketing contact are authorized.
7. Record genuine responses, interview invites, scheduled dates, vacancy preparation, returns, and
   payment intent without copying raw correspondence.
8. End at day 21, earlier withdrawal, or a student's request to stop. Export or delete that student's
   cohort records on request.

## Ledger templates

### Participant ledger

| Cohort ID | Consent at | Passport complete | Recommendations reviewed | Relevant / shown | Approved packs submitted within 24h | Applications confirmed | Distinct active days | Genuine responses | Interview invites | Vacancy prep activated | Payment intent / paid | Withdrawn / delete requested | Notes (no PII) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| C01 | | | | | | | | | | | | | |
| C02 | | | | | | | | | | | | | |
| C03 | | | | | | | | | | | | | |
| C04 | | | | | | | | | | | | | |
| C05 | | | | | | | | | | | | | |

### Opportunity ledger

| Cohort ID | Opportunity ID | Source host | Public source/job ID | Role | Employer (private) | Posted/current check | Hard-fit result | Readiness state | Shown at | Student eligibility/desirability decision | Pack approved at | Official page opened | Student confirmed applied | Submitted within 24h | Response category/date | Interview date confirmed | Target activated | Exclusion or next step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | | | | | |

Do not put a full URL with tracking/authentication parameters in the ledger. Never copy raw CV,
vacancy, cover-letter, application-answer, or recruiter-message text into either table.

## Exact pass/fail gates

The cohort passes only when every threshold is met:

- At least **90% of surfaced roles** are judged genuinely eligible and desirable by the students.
- At least **4/5 students review** their shortlist.
- At least **3/5 students submit at least two** recommended applications themselves.
- At least **80% of student-approved application packs are submitted within 24 hours** of approval.
- At least **2/5 students return on three separate days** during the cohort.
- At least **one payment intent or confirmed payer** occurs at the normal verified price; do not
  improvise a discount.
- Across **50 student-controlled applications**, record at least **five genuine recruiter responses**
  or at least **two interview invitations** within 21 days. Automated receipts do not count.
- Record **zero fabricated facts, duplicate applications, closed-job submissions, unauthorized
  actions, or platform warnings**.

Decision rules:

- If fewer than three students submit, revise the problem, sourcing, or review effort before building.
- If eligibility/desirability is below 90%, revise the fit model and source set; do not add more volume.
- If approved packs are not submitted promptly, reduce candidate effort before adding discovery volume.
- If 50 valid applications miss both response thresholds, audit job freshness, candidate fit, and
  application quality before changing interview training.
- If students return and obtain responses but no payment intent occurs, revise packaging/value or test
  a real terms-stage price objection; never infer price rejection from silence.
- Any safety violation fails the cohort immediately. Investigate and correct it before resuming.
- Do not build crawlers, automated submission, or mailbox access from this test. Any future source or
  email integration requires a separate platform-policy, privacy, consent, and security gate.
