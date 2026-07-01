/**
 * idiolect.js — a seeded per-session "verbal fingerprint" for the interviewer.
 *
 * WHY: the boss can sound RECITED because every session pulls from the same rule set the same way,
 * so it has no consistent personal voice — and no variation between runs. This pins 2 concrete spoken
 * HABITS per session (deterministically from the sessionId), so the interviewer feels like ONE specific
 * person within a conversation, and a DIFFERENT one next time. Pure, $0, no model call.
 *
 * The pool is register-SAFE: every item works for the warm junior recruiter AND the strict board
 * director (no slang), because the persona + forcefulness block already set the base register — the
 * idiolect only adds a consistent flavour on top. These are spoken MOVES, not casualness.
 */

// Each entry is a concrete, correct-German spoken habit an interviewer can consistently exhibit.
export const IDIOLECT_POOL = [
  'Knappe Quittung: Beginne oft mit einem einzigen kurzen Wort — „Gut.", „So.", „Nun.", „Verstehe." — statt mit einem vollen Satz.',
  'Hörbares Nachdenken: Setze gelegentlich ein „…" oder ein knappes „Hm," an den Anfang, als überlegtest du kurz.',
  'Nackte Rückfrage: Stell ab und zu eine Ein- oder Zwei-Wort-Rückfrage als GANZEN Beitrag: „Inwiefern?", „Konkret?", „Und dann?", „Das Ergebnis?".',
  'Wörtlicher Rückgriff: Greif betont oft ein EXAKTES Wort des Kandidaten wieder auf, statt es zu umschreiben.',
  'Betont knapp: Halte deine Redebeiträge auffällig kurz — meist ein bis zwei Sätze.',
  'Einräumen, dann wenden: Nutze gern „Schon, aber …" oder „Mag sein, nur …", bevor du nachhakst.',
  'Abgestufte Zwischentöne: Reagiere oft mit „Teils teils.", „Geht in die Richtung.", „Das schon." statt eines klaren Urteils.',
  'Ruhige Pausen: Lass ab und zu einen Satz mit „…" offen enden, damit der Kandidat ihn vervollständigt.',
];

// FNV-1a → uint32 (same family as realtimeClient's mood seed; kept local so this module is standalone).
export function seedFrom(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Pick n DISTINCT items from arr, deterministically from seed.
export function pickN(arr, seed, n) {
  const pool = [...arr];
  const out = [];
  let s = seed >>> 0;
  for (let k = 0; k < n && pool.length; k++) {
    s = Math.imul(s ^ 0x9e3779b9, 2654435761) >>> 0;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}

/**
 * The idiolect instruction block for a session (deterministic from sessionId). Append to the boss's
 * system instructions. Returns '' if the pool is somehow empty (never breaks the interview).
 */
export function seededIdiolect(sessionId, n = 2) {
  const picks = pickN(IDIOLECT_POOL, seedFrom(`${sessionId}:idiolect`), n);
  if (!picks.length) return '';
  return (
    `\n\nDEIN SPRACH-FINGERABDRUCK für dieses Gespräch (mach ihn zu DEINER Gewohnheit und bleib bis zum ` +
    `Ende konsequent dabei — so klingst du wie EIN bestimmter Mensch, nicht wie ein Regelwerk): ` +
    picks.map((p) => `• ${p}`).join(' ') +
    ` Diese Gewohnheiten gehören zu DIR, nicht zu jedem Interviewer. Bleib dabei, aber übertreib sie nicht ` +
    `und lass sie immer zu deiner Rolle und deinem Ton passen.`
  );
}

export default { IDIOLECT_POOL, seedFrom, pickN, seededIdiolect };
