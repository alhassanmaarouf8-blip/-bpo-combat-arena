# Salma intervention policy

Salma is the evidence-grounded personal interview tutor. BrainGuide remains the only authority for the learner's next action. Salma may explain that action, demonstrate it, supervise an attempt, and answer a question. She must not create a second plan, infer readiness from self-report, imitate an employer, or promise employment.

## Speech gate

Salma may speak automatically only when all of these conditions are true:

1. The learner explicitly enabled automatic speech and has not muted Salma.
2. The document is visible and no microphone, interviewer, drill audio, or learner recording is active.
3. The server supplied a new, stable event ID that the account has not acknowledged.
4. The event changes the learner's next action or supplies a correction that is useful before the next attempt.
5. The message can be stated from verified, allowlisted evidence.

Opening a screen, reopening a drill, completing an ordinary item, reloading the app, or navigating is never sufficient reason to speak.

## Intervention matrix

| Situation | Automatic speech | What Salma says | Repetition rule |
|---|---:|---|---|
| Ordinary app or drill open | No | Nothing. The current BrainGuide action remains visible. | Never |
| New reliable diagnosis | Optional, once | One bottleneck, its evidence, the prescribed block, and the success gate. | Once per evidence-hashed prescription ID |
| Thin or interrupted evidence | Optional, once | She cannot diagnose yet; names the exact missing measurement and sends the learner to it. | Once per measurement directive ID |
| New debrief changes the plan | Optional, once | What changed and the new BrainGuide action. | Once per debrief event ID |
| Same verified error repeats | Optional, between attempts | One correction and the exact next repetition. | At most two automatic spoken corrections per drill session |
| Learner is stuck | Only from verified interaction state | One short explanation and one next action. | Once per stuck-state event ID; no timer-only nudging |
| Learner asks a question | User initiated | One explanation, one example when useful, one next action. | Every genuine question, within entitlement limit |
| Ordinary drill completion | No | A concise visual receipt may show verified progress; no generic praise speech. | Never |
| Matched retest result | Optional, once | Metric before/after and whether transfer still remains. | Once per verified result ID |
| Novel/pressure transfer result | Optional, once | Metric before/after and whether the improvement held in the new situation. | Once per verified result ID |

## Message shape

Spoken interventions should normally fit within 12-22 seconds and follow this order:

1. **Finding:** one observed fact, or an explicit statement that evidence is insufficient.
2. **Meaning:** why it matters inside this training simulation.
3. **Action:** the one BrainGuide-selected step with dose and success gate.

No greeting, praise, biography, sales message, trial reminder, rank ceremony, or repeated context is added unless it materially changes the action. Technical evidence, thresholds, and caveats remain available under progressive disclosure instead of being read aloud.

## UI hierarchy

The home experience shows, in order:

1. The single next action and why it was selected.
2. The exact dose and success gate.
3. A quiet `Why this?` disclosure for evidence, confidence, simulation caveat, and matched/transfer status.
4. A compact `Ask Salma` control.
5. Tutor preferences under a secondary disclosure.

Detailed units, internal references, and retest history must never compete visually with the primary action. In a drill, Salma appears only after a graded attempt, when an event-specific cue exists, or when the learner opens help.

## Claims

- Say `trainingsinterview`, `simulation`, or `internal training reference`; never call an app session a real employer interview.
- Say `observed risk in this simulation`; never claim knowledge of an employer decision.
- Say `verified in a matched retest` or `held in a new transfer situation`; never claim the drill alone caused improvement.
- Do not state a clock time unless the learner supplied a preferred window. Use `now` and the verified minimum spacing otherwise.
- Do not claim that a completed drill changed the learner model until server evidence is accepted.

## Release gate

Every new automatic line needs a stable event source, idempotency test, overlap test, hidden-tab test, German-language review, and proof that it remains silent when the event is absent. Dynamic Masri remains disabled until an exact written and frozen-audio phrase pack passes native review.
