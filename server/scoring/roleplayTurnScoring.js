/**
 * Role-specific, transcript-only live HUD evidence.
 *
 * These signals adjust the cinematic HP display for one completed turn. They are not a mastery
 * decision, employer prediction, or substitute for the multi-turn evidence gates used by Salma.
 * Every reward maps to an observable act; contradictions fail closed for the role-content layer.
 */

const ROLE_TYPES = new Set(['customer_service', 'technical_support', 'sales', 'retention', 'backoffice']);

const RX = Object.freeze({
  customer_service: Object.freeze({
    negatives: [
      /\b(?:keine|null)\s+verantwortung\b/u,
      /\b(?:nicht|niemals)\s+(?:mein|unser)\s+problem\b/u,
      /\b(?:wir|ich)\s+(?:werden|werde|k\u00f6nnen|kann)\s+(?:gar\s+)?(?:nichts|nicht)\s+(?:tun|machen|pr\u00fcfen|kl\u00e4ren)\b/u,
      /\b(?:sie\s+sind|das\s+ist)\s+selbst\s+schuld\b/u,
    ],
    acts: [
      ['Empathie', 6, /\b(?:das\s+tut\s+mir\s+(?:wirklich\s+)?leid|ich\s+(?:kann\s+)?(?:ihren?\s+\u00e4rger|ihre\s+situation)\s+(?:gut\s+)?(?:verstehen|nachvollziehen))\b/u],
      ['Verantwortung', 5, /\bich\s+(?:k\u00fcmmere\s+mich\s+(?:jetzt\s+)?(?:um|darum)|pr\u00fcfe|kl\u00e4re|eskaliere|veranlasse)\b/u],
      ['klarer n\u00e4chster Schritt', 5, /\b(?:als\s+n\u00e4chstes|ich\s+melde\s+mich\s+(?:noch\s+)?(?:heute|morgen|innerhalb)|sie\s+(?:erhalten|bekommen)\s+.{0,40}\b(?:heute|morgen|innerhalb))\b/u],
    ],
  }),
  technical_support: Object.freeze({
    negatives: [
      /\b(?:garantiert|hundertprozentig)\s+(?:gel\u00f6st|behoben)\b/u,
      /\b(?:l\u00f6schen|zur\u00fccksetzen|formatieren)\s+sie\s+(?:sofort\s+)?(?:alle|ihre)\s+daten\b/u,
      /\bich\s+rate\s+(?:einfach|mal)\b/u,
    ],
    acts: [
      ['Problem zusammengefasst', 5, /\b(?:wenn\s+ich\s+sie\s+richtig\s+verstehe|das\s+problem\s+ist|seit\s+dem\s+update|sie\s+sagen,?\s+dass)\b/u],
      ['gezielte Diagnosefrage', 6, /\b(?:seit\s+wann|welche\s+fehlermeldung|betrifft\s+es|funktioniert\s+es|haben\s+sie\s+bereits|k\u00f6nnen\s+sie\s+bitte)\b[^?]{0,100}\?/u],
      ['sicherer Pr\u00fcfschritt', 5, /\b(?:zuerst|als\s+erstes|im\s+n\u00e4chsten\s+schritt|bitte\s+pr\u00fcfen|wir\s+testen)\b/u],
    ],
  }),
  sales: Object.freeze({
    negatives: [
      /\b(?:sie\s+m\u00fcssen|nur\s+heute|letzte\s+chance|garantiert|hundertprozentig)\b/u,
      /\bich\s+ignoriere\s+ihr\s+nein\b/u,
      /\bohne\s+ihre\s+zustimmung\b/u,
    ],
    acts: [
      ['Einwand anerkannt', 5, /\b(?:ich\s+verstehe\s+ihren\s+einwand|das\s+ist\s+nachvollziehbar|danke\s+f\u00fcr\s+ihre\s+offenheit)\b/u],
      ['Bedarf gekl\u00e4rt', 6, /\b(?:was\s+ist\s+ihnen|welches\s+ziel|woran\s+liegt|was\s+fehlt|welche\s+anforderung|darf\s+ich\s+fragen)\b[^?]{0,110}\?/u],
      ['passender n\u00e4chster Schritt', 5, /\b(?:wenn\s+.{0,60}\b(?:wichtig|priorit\u00e4t)\b.{0,80}\b(?:passt|bietet|hilft)|als\s+n\u00e4chstes\s+k\u00f6nnen\s+wir|ich\s+kann\s+ihnen\s+.{0,60}\bzeigen)\b/u],
      ['Nein respektiert', 4, /\b(?:selbstverst\u00e4ndlich\s+respektiere\s+ich|ich\s+respektiere\s+ihre\s+entscheidung|kein\s+problem,?\s+vielen\s+dank)\b/u],
    ],
  }),
  retention: Object.freeze({
    negatives: [
      /\b(?:sie\s+d\u00fcrfen\s+nicht|ich\s+akzeptiere\s+ihre\s+k\u00fcndigung\s+nicht|nur\s+heute|letzte\s+chance)\b/u,
      /\bohne\s+ihre\s+zustimmung\b/u,
      /\bich\s+verhindere\s+die\s+k\u00fcndigung\b/u,
    ],
    acts: [
      ['K\u00fcndigungswunsch anerkannt', 5, /\b(?:ich\s+verstehe,?\s+dass\s+sie\s+k\u00fcndigen|ihren\s+k\u00fcndigungswunsch\s+habe\s+ich\s+verstanden|das\s+respektiere\s+ich)\b/u],
      ['Grund gekl\u00e4rt', 6, /\b(?:darf\s+ich\s+fragen,?\s+warum|was\s+ist\s+der\s+hauptgrund|liegt\s+es\s+an)\b[^?]{0,100}\?/u],
      ['Erlaubnis vor Alternative', 5, /\b(?:darf\s+ich\s+ihnen\s+(?:eine|kurz)|w\u00e4ren\s+sie\s+offen\s+f\u00fcr|m\u00f6chten\s+sie\s+eine\s+alternative)\b/u],
      ['Entscheidung respektiert', 4, /\b(?:ich\s+respektiere\s+ihre\s+entscheidung|selbstverst\u00e4ndlich\s+f\u00fchre\s+ich\s+die\s+k\u00fcndigung|dann\s+best\u00e4tige\s+ich\s+ihnen\s+die\s+k\u00fcndigung)\b/u],
    ],
  }),
  backoffice: Object.freeze({
    negatives: [
      /\bich\s+(?:rate|sch\u00e4tze|vermute)\b/u,
      /\bohne\s+(?:pr\u00fcfung|beleg|freigabe|best\u00e4tigung)\b/u,
      /\bich\s+\u00e4ndere\s+(?:das|die\s+daten)\s+einfach\b/u,
    ],
    acts: [
      ['Datenkonflikt benannt', 5, /\b(?:die\s+angaben\s+widersprechen\s+sich|es\s+fehlt\s+.{0,50}\b(?:pflichtfeld|referenz|beleg)|die\s+adresse\s+ist\s+nicht\s+eindeutig|ich\s+sehe\s+zwei\s+unterschiedliche)\b/u],
      ['verbindliche Quelle erfragt', 6, /\b(?:welche\s+quelle\s+ist\s+verbindlich|k\u00f6nnen\s+sie\s+.{0,50}\b(?:beleg|referenz|best\u00e4tigung|freigabe)\b|bitte\s+best\u00e4tigen\s+sie)\b/u],
      ['dokumentierter n\u00e4chster Schritt', 5, /\b(?:ich\s+dokumentiere|ich\s+halte\s+fest|nach\s+der\s+best\u00e4tigung\s+werde\s+ich|als\s+n\u00e4chstes\s+pr\u00fcfe\s+ich)\b/u],
    ],
  }),
});

function normalize(text) {
  return ` ${String(text || '').normalize('NFKC').toLocaleLowerCase('de-DE').replace(/\s+/gu, ' ').trim()} `;
}

/** Return only directly observed, role-specific live-HUD factors. */
export function roleplayTurnFactors(transcript, roleType) {
  if (!ROLE_TYPES.has(roleType)) return Object.freeze({ roleType: null, contradicted: false, factors: Object.freeze([]) });
  const text = normalize(transcript);
  const rubric = RX[roleType];
  const contradicted = rubric.negatives.some((pattern) => pattern.test(text));
  const factors = contradicted
    ? [{ side: 'player', label: 'widerspr\u00fcchliche Rollenhandlung', hp: 7 }]
    : rubric.acts.filter(([, , pattern]) => pattern.test(text)).map(([label, hp]) => ({ side: 'boss', label, hp }));
  return Object.freeze({ roleType, contradicted, factors: Object.freeze(factors.map(Object.freeze)) });
}

const ROLEPLAY_LABELS = Object.freeze({
  customer_service: 'De-Eskalation',
  technical_support: 'Technische Diagnose',
  sales: 'Bedarf und Einwand',
  retention: 'Kundenbindung mit Einwilligung',
  backoffice: 'Datenpr\u00fcfung',
});

/** Bounded display summary from completed stage-3 turns; never persisted as mastery evidence. */
export function roleplayTurnSummary(turns, roleType) {
  if (!ROLE_TYPES.has(roleType)) return null;
  const safeTurns = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.stage === 2 && typeof turn?.text === 'string')
    .map((turn) => turn.text.trim()).filter(Boolean).slice(0, 20);
  const wordCount = safeTurns.reduce((sum, text) => sum + (text.match(/[\p{L}\p{N}]+/gu)?.length || 0), 0);
  if (safeTurns.length < 2 || wordCount < 20) return null;
  const results = safeTurns.map((text) => roleplayTurnFactors(text, roleType));
  const contradicted = results.some((result) => result.contradicted);
  const labels = new Set(results.flatMap((result) => result.factors)
    .filter((factor) => factor.side === 'boss').map((factor) => factor.label));
  const totalActs = RX[roleType].acts.length;
  return Object.freeze({ label: ROLEPLAY_LABELS[roleType], score: contradicted ? 0 : Math.round(labels.size / totalActs * 100),
    observedActs: contradicted ? 0 : labels.size, totalActs, contradicted });
}

export default { roleplayTurnFactors, roleplayTurnSummary };
