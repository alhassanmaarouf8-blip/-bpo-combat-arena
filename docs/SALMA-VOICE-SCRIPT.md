# SALMA — voice-clip script (owner's one-time generation, OPTIONAL)

Salma ships **text-only** ($0). If you want her to speak at the big ceremonial moments, these
~12 **slot-free** lines (voice clips can't carry dynamic values) are the complete set. Generate
them ONCE (ElevenLabs, your voice pick — a warm Egyptian female), drop the mp3s into
`client/public/salma/<key>.mp3`, and a follow-up session wires playback through the existing
gesture-unlocked player (`playClipFromUrl`, App.jsx) at the trigger moments below.

**Rules:** you re-voice each line in your own masri before generating (the DE column is the
meaning, not the script). Keep each clip ≤ 6 seconds. One-time cost, cached forever after.

| key | German (meaning) | EN gloss | Trigger moment |
|---|---|---|---|
| welcome | Willkommen! Ich bin Salma, deine Recruiterin. | Welcome! I'm Salma, your recruiter. | Cold-open WELCOME beat |
| screening_start | Fünf Fragen. Sprich frei — ich höre zu. | Five questions. Speak freely — I'm listening. | Assessment opens from her flow |
| verdict_ready | Deine Auswertung ist da. | Your evaluation is in. | VERDICT beat appears |
| booking | Dein Termin steht. Zeig, was du kannst. | Your appointment is set. Show what you can do. | Tapping "Zum Interview" |
| first_win | Erstes Interview gewonnen — ich hab's notiert. | First interview won — I've noted it. | First fight ends in a win |
| warm_loss | Kopf hoch. Genau dafür trainieren wir. | Chin up. That's exactly what we train for. | A fight ends in a loss |
| comeback | Da bist du ja wieder — deine Akte liegt noch auf meinem Tisch. | There you are — your file is still on my desk. | First open after ≥3 idle days |
| streak_praise | Jeden Tag da — so sehen Kandidaten aus, die es schaffen. | Here every day — that's what candidates who make it look like. | Streak hits 3, 7, 14 |
| level_up | Neuer Rang. Ich kann dich jetzt weiter oben vorstellen. | New rank. I can now put you forward higher up. | Rank-up in the debrief |
| final_boss | Die Geschäftsführerin will dich sehen. Bereit? | The managing director wants to see you. Ready? | Frau Mona Adel unlocked |
| paywall_honest | Auf der freien Akte kann ich nur screenen — du entscheidest. | On the free file I can only screen — you decide. | Paywall shown |
| sign_off | Ich bin da, wenn du bereit bist. | I'm here when you're ready. | Cold-open skipped/closed |
