# Build spec — "Meine eigenen Fragen" (upload your own interview questions)

**Status:** spec, 2026-07-23. Recommended as a **post-launch V2 headline** (do not block the Play launch).
**Owner idea:** a student uploads photos/screenshots of the exact questions they expect (from a friend at
the target employer, a forum, a job post) → the AI interviewer interviews them on **those**.

## Why (the value bar)
This is the highest-value thing an interview trainer can do: practice the **real likely test**, not a
generic bank. It maps 1:1 to the mission (get hired) and nobody in this niche does it. Real value, not a
gimmick — passes the anti-slop CONGRUENT test cleanly.

## User flow
1. **Entry:** In the Ziel-Stelle picker (currently `INDUSTRIES` — auto, telekommunikation, …) add a new
   option **"Meine eigenen Fragen"** (own-material mode). Or a distinct card next to it.
2. **Upload:** pick/take **1–5 images** (mobile camera or gallery). Show thumbnails.
3. **Extract:** server sends images to a **vision model** → returns a list of interview questions **as
   German interview questions** (translate if the upload is Arabic/English notes; the target is a German
   interview).
4. **Confirm/edit (MANDATORY):** show the extracted questions in an **editable list** — user removes junk,
   fixes OCR errors, adds their own, reorders. *Never run an interview on unconfirmed OCR.*
5. **Store:** save the confirmed set to the profile as a `customQuestionSet` (list + createdAt).
6. **Interview:** the normal voice interview runs, but the interviewer asks **these** questions (persona,
   timing, scoring, debrief all unchanged).

## Architecture

### Vision extraction (the ONE genuinely new piece)
- Provider: **Gemini vision** (free tier → fits the $0 rule; infra already present — `geminiLive.js`,
  `vertexToken.js`). New endpoint **`POST /api/custom-questions/extract`** (auth + rate-limited).
- Input: base64 images (client compresses first, cap ~1MB each). Output: `{ questions: string[], note }`.
- Prompt intent: *"Extract every interview question from these images. Return them as clear German
  interview questions a hiring interviewer would ask (translate non-German). Ignore anything that is not
  an interview question. If none are found, return an empty list."*
- **Honest guards (anti-slop):**
  - No questions found → `questions: []` + a note; UI says "Keine Fragen erkannt — tippe sie ein oder lade
    ein klareres Bild hoch." **Never fabricate questions.**
  - Cap output (≤15 questions). Strip duplicates/near-duplicates.
  - **Privacy:** extract text, then **discard the raw image** (don't persist photos). Store only the text.

### Storing the set
- Add `customQuestionSet: { questions: string[], createdAt }` to the user profile (`store.js` shape).
- Endpoints: `POST /api/custom-questions` (save confirmed set), `GET /api/custom-questions` (load),
  `DELETE` (clear). Rate-limit the extract endpoint (cost/abuse: e.g. 10/hour).

### Injecting into the interview engine
- The interview questions are built in **`server/scenarios.js` `buildSessionScript`** (+ `pickCsScenario`
  filters by `targetIndustry`). Add a **custom mode**: when the session's target is "own questions", the
  script's question source is the user's `customQuestionSet` instead of the scenario bank.
- The boss/persona (`realtimeClient.js`) is unchanged — it just asks the injected questions in order
  (with the normal ÜBERGÄNGE/FADEN follow-up rules, so it stays conversational, not a robotic Q-reader).
- Scoring/debrief (`turnQuality.js`, `coach.js`, `hireReadiness.js`) are **unchanged** — they grade any
  Q&A. This is the big win: reuse everything; only the question source changes.

### Client
- New Ziel-Stelle option + an upload/extract/confirm overlay (registered in `_overlays`, design-system
  primitives, blue+orange, OWNER-AR slots for masri).
- Image compress client-side before upload (canvas → jpeg, ~1MB). Editable question list (add/edit/remove/
  reorder). "Interview mit meinen Fragen starten" → `beginSession({ customQuestions: true })`.

## Decisions — LOCKED (sensible defaults, owner 2026-07-23 "your call")
1. **Entitlement:** **trial-included** — available during the 3-day free trial AND to paid users. It's
   the conversion hook (feel the value on your OWN questions during the trial → pay). Not for expired-
   trial free accounts (they hit the paywall like everywhere).
2. **Language of upload:** **accept ANY language** (Arabic/English notes, German screenshots) → the vision
   model always outputs **German interview questions** (the target is a German interview). Maximizes reach
   for the Arabic-first audience.
3. **Limits:** **5 images/upload · ≤15 questions/set · 10 extracts/hour/user** (rate-limited endpoint).
   Client-compress each image to ~1MB before upload.
4. **Persistence:** **one active custom set** (a new upload replaces it) for the MVP. A saved multi-set
   library is P2 polish.

## Phasing
- **P1 (MVP):** upload → vision extract → confirm/edit → store → inject into interview. Text-typed
  fallback if vision fails. (Ships the whole value.)
- **P2 (polish):** in-app camera capture, multi-set library, smarter extraction (dedup, follow-up
  generation from a question), share-a-set.

## Verification (god-verification ladder)
- **Unit:** the extract parser/guard (mock vision JSON → questions; junk → []; cap/dedup). The injection
  (custom set present → buildSessionScript uses it; absent → normal bank).
- **Live:** upload a real screenshot of German questions → extract → confirm → start interview → the boss
  asks those exact questions → debrief scores normally. On owner's device/mic.
- **Guard:** a non-question image → UI honestly says "keine Fragen erkannt", no interview starts on junk.

## Files to touch
- Server: `scenarios.js` (buildSessionScript custom mode), new `customQuestions.js` (extract via Gemini
  vision + save/load), `store.js` (profile field), route wiring, a unit test.
- Client: `App.jsx` (Ziel-Stelle option + beginSession param), a new upload/confirm overlay component,
  `geminiVoice.js`/image-compress helper.
- Reuse unchanged: `realtimeClient.js` persona, `turnQuality.js`/`coach.js`/`hireReadiness.js` scoring.
