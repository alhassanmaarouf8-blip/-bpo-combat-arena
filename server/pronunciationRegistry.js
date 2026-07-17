/**
 * Frozen pronunciation-deviation registry.
 *
 * A registry entry is a CLAIM BOUNDARY, not evidence that the app can already
 * measure the category. `releaseStatus` stays `unvalidated` until an expert-gold
 * holdout report passes every category gate. Production must never infer support
 * merely because an id exists here.
 */
export const PRONUNCIATION_PROTOCOL_VERSION = 'german-clarity-v1';

const COMMON = Object.freeze({
  releaseStatus: 'unvalidated',
  minimumVoicedMs: 600,
  minimumDistinctWords: 2,
  acceptedImpact: Object.freeze(['clarity_risk', 'intelligibility_risk']),
  mastery: Object.freeze({ matchedRetest: true, novelPressureRetest: true }),
});

function entry(value) {
  return Object.freeze({ ...COMMON, ...value,
    contexts: Object.freeze([...value.contexts]),
    acceptedVariants: Object.freeze([...(value.acceptedVariants || [])]),
    abstainWhen: Object.freeze([...(value.abstainWhen || [])]),
  });
}

export const PRONUNCIATION_DEVIATIONS = Object.freeze({
  vowel_length: entry({ contexts: ['prompted', 'spontaneous_high_confidence'], detectorFamily: 'phone_alignment',
    acceptedVariants: ['standard_regional_non_blocking'], abstainWhen: ['alignment_uncertain', 'duration_boundary_uncertain'] }),
  vowel_quality: entry({ contexts: ['prompted'], detectorFamily: 'phone_alignment',
    acceptedVariants: ['standard_regional_non_blocking'], abstainWhen: ['alignment_uncertain', 'confusable_without_impact'] }),
  ich_ach_fricative: entry({ contexts: ['prompted', 'spontaneous_high_confidence'], detectorFamily: 'phone_alignment',
    acceptedVariants: ['standard_contextual_allophone'], abstainWhen: ['unknown_word', 'alignment_uncertain'] }),
  consonant_contrast: entry({ contexts: ['prompted'], detectorFamily: 'phone_alignment',
    acceptedVariants: ['standard_final_devoicing'], abstainWhen: ['meaning_preserved_harmless_variant', 'alignment_uncertain'] }),
  consonant_cluster: entry({ contexts: ['prompted', 'spontaneous_high_confidence'], detectorFamily: 'phone_alignment',
    abstainWhen: ['compound_boundary_uncertain', 'alignment_uncertain'] }),
  segment_deletion: entry({ contexts: ['prompted', 'spontaneous_high_confidence'], detectorFamily: 'phone_alignment',
    acceptedVariants: ['standard_schwa_reduction'], abstainWhen: ['casual_reduction_without_clarity_harm', 'alignment_uncertain'] }),
  segment_insertion: entry({ contexts: ['prompted'], detectorFamily: 'phone_alignment',
    abstainWhen: ['disfluency_boundary_uncertain', 'alignment_uncertain'] }),
  lexical_stress: entry({ contexts: ['prompted'], detectorFamily: 'prosody',
    acceptedVariants: ['compound_secondary_stress'], abstainWhen: ['stress_peak_uncertain', 'unknown_word'] }),
  unstable_articulation: entry({ contexts: ['prompted', 'spontaneous_high_confidence'], detectorFamily: 'combined',
    abstainWhen: ['recording_quality_failed', 'single_occurrence'] }),
  excessive_pausing: entry({ contexts: ['flow', 'interview'], detectorFamily: 'prosody',
    acceptedVariants: ['meaningful_rhetorical_pause'], abstainWhen: ['capture_interrupted', 'too_little_speech'] }),
  rushed_compression: entry({ contexts: ['flow', 'interview'], detectorFamily: 'prosody',
    abstainWhen: ['duration_unreliable', 'too_little_speech'] }),
  unclear_phrase_boundaries: entry({ contexts: ['flow', 'interview'], detectorFamily: 'prosody',
    acceptedVariants: ['task_appropriate_emphasis'], abstainWhen: ['syntax_unavailable', 'capture_interrupted'] }),
  speech_rate_clarity: entry({ contexts: ['flow', 'interview'], detectorFamily: 'prosody',
    abstainWhen: ['duration_unreliable', 'too_little_speech'] }),
});

export function pronunciationDeviation(id) {
  return typeof id === 'string' && Object.hasOwn(PRONUNCIATION_DEVIATIONS, id)
    ? PRONUNCIATION_DEVIATIONS[id] : null;
}

export function releasedPronunciationDeviation(id, releases = {}) {
  const item = pronunciationDeviation(id);
  const release = releases?.[id];
  return item && release?.passed === true && release?.protocolVersion === PRONUNCIATION_PROTOCOL_VERSION
    ? item : null;
}

