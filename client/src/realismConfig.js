/**
 * realismConfig.js — THE single source of truth for interview realism (Phases 2–5, FINAL).
 *
 * Every effect is a tunable constant + an on/off boolean. Overall intensity DERIVES from the
 * learner's CEFR difficulty tier via named presets (REALISM SCALES WITH LEVEL):
 *   beginner (a2-b1) → near-clean, patient   |   advanced (b2) → full phone degradation.
 *
 * HARD RULES honored here: all audio driven by this config is OUTPUT-ONLY (the interviewer's
 * voice + room) — it NEVER touches the mic, recording, transcription, or scoring. Volumes are
 * deliberately low so the German voice stays clearly intelligible (intelligibility floor).
 * Randomness is SEEDED per session so a session is consistent and tests are repeatable.
 */

// ── Level presets ────────────────────────────────────────────────────────────────────
export const realismProfiles = {
  beginner: {
    masterIntensity: 0.15,
    mood:            'patient',
    ambient:   { enabled: false, volume: 0.05, activityLevel: 0.15 },
    diegetic:  { enabled: false, rate: 0.0 },
    telephone: { enabled: false, lowCut: 300, highCut: 3400, q: 0.7, compression: 6,  noiseFloor: 0.004 },
    clarificationRate: 0,          // mirrors the server (never for beginners)
  },
  intermediate: {                  // reserved for a future middle tier; not currently mapped
    masterIntensity: 0.5,
    mood:            'neutral',
    ambient:   { enabled: true,  volume: 0.05, activityLevel: 0.3 },
    diegetic:  { enabled: true,  rate: 0.25 },
    telephone: { enabled: true,  lowCut: 300, highCut: 3600, q: 0.7, compression: 8,  noiseFloor: 0.006 },
    clarificationRate: 0.02,
  },
  advanced: {
    masterIntensity: 0.85,
    mood:            'tired-friday',
    ambient:   { enabled: true,  volume: 0.09, activityLevel: 0.5 },
    diegetic:  { enabled: true,  rate: 0.4 },
    telephone: { enabled: true,  lowCut: 300, highCut: 3400, q: 0.9, compression: 10, noiseFloor: 0.012 },
    clarificationRate: 0.06,
  },
};

// The app exposes two CEFR tiers: 'a2-b1' (beginner) and 'b2' (advanced). Map tier → preset.
export function profileForLevel(levelId) {
  return levelId === 'b2' ? 'advanced' : 'beginner';
}

// ── Seeded RNG (mulberry32) — deterministic per session, repeatable for tests ──────────
export function makeRng(seedStr) {
  let s = 2166136261 >>> 0;
  const str = String(seedStr || 'default');
  for (let i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); }
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) base[k] = deepMerge(base[k] || {}, over[k]);
    else base[k] = over[k];
  }
  return base;
}

/**
 * Build the active realismConfig for this session: the level preset, plus the session seed,
 * plus any live override placed on window.__realismOverride (for A/B testing — see installRealismConsole).
 */
export function buildRealismConfig(levelId, sessionId) {
  const profile = profileForLevel(levelId);
  const cfg = deepClone(realismProfiles[profile]);
  cfg.profile = profile;
  cfg.levelId = levelId || 'a2-b1';
  cfg.seed    = sessionId || 'default';
  if (typeof window !== 'undefined' && window.__realismOverride) {
    deepMerge(cfg, window.__realismOverride);
  }
  return cfg;
}

/**
 * Console A/B harness. After a session starts, the live RealismAudio instance is on
 * window.__realism. This installs helpers so you can toggle/override each layer live:
 *
 *   realism.show()                          // current config
 *   realism.set({ telephone:{ enabled:false } })   // override + re-apply live
 *   realism.set({ ambient:{ volume:0.2 } })        // louder office bed
 *   realism.profile('beginner'|'advanced')  // jump to a preset live
 *   realism.off()                           // kill ALL realism (plain voice) instantly
 */
export function installRealismConsole(getInstance) {
  if (typeof window === 'undefined') return;
  window.realism = {
    show()        { const i = getInstance(); console.log(i ? i.cfg : '(no active session)'); return i?.cfg; },
    set(over)     { window.__realismOverride = deepMerge(window.__realismOverride || {}, over); getInstance()?.apply(window.__realismOverride); return 'applied'; },
    profile(name) { window.__realismOverride = deepClone(realismProfiles[name] || realismProfiles.beginner); getInstance()?.apply(window.__realismOverride); return name; },
    off()         { window.__realismOverride = { masterIntensity: 0, ambient:{enabled:false}, telephone:{enabled:false}, diegetic:{enabled:false} }; getInstance()?.apply(window.__realismOverride); return 'realism OFF (plain voice)'; },
  };
}
