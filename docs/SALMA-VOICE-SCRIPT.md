# Salma — fixed Masri phrase-pack release gate

Salma is German-only until a complete, versioned phrase pack passes this gate. Historical Arabic
copy is review material, not production approval. Runtime generation is not a substitute for native
review, and the app must fall back to German whenever a phrase or asset is missing.

## Required approval record

Every candidate phrase needs one immutable record containing:

- a stable phrase key and exact German meaning;
- the exact Cairene written line;
- native-owner approval of its vocabulary, register, rhythm, and code-switching;
- the exact frozen audio asset and its SHA-256 hash;
- native-owner approval of that audio;
- verified playback on phone, laptop, and headphones;
- the pack version that contains the phrase.

Parameterized phrases are permitted only when every grammatical form is a separately approved,
hashed asset. German technical terms stay in German script. Free-form tutor answers stay German.

## Release conditions

The server may advertise a Masri pack only when all of these are true:

1. `SALMA_COACH_MODE` enables the owner beta or release cohort.
2. `SALMA_COACH_VOICE_ENABLED=true`.
3. `SALMA_MASRI_PACK_VERSION` names a complete approved manifest.
4. Every referenced asset hash matches the manifest.
5. The client and server reject unlisted phrases and fall back to German.

Until a real manifest and frozen assets exist, `masriAvailable` remains false and the runtime
`salma-masri` TTS ticket is rejected. No paid provider is required or authorized by this document.
