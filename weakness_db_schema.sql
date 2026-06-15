-- ============================================================
--  OMNI-PERFORM  ·  WEAKNESS-DB  (additive migration)
-- ------------------------------------------------------------
--  The compounding engine.
--    1. Log every detected error  (error_events, append-only)
--    2. Roll it up per student      (weakness_profile)
--    3. Feed the worst into the final interview (read query, bottom)
--
--  Controlled vocabulary lives in weakness_taxonomy, which ALSO
--  stores the "how to attack this in the interview" prompt — so the
--  taxonomy is the bridge between detection and interrogation.
--
--  This migration is PURELY ADDITIVE. It creates three new tables
--  and touches nothing that already exists in your app.
-- ============================================================


-- ====================  UP  ==================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Controlled vocabulary of weaknesses.
--    A detector MUST emit an error_key that exists in this table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weakness_taxonomy (
    error_key         TEXT        PRIMARY KEY,              -- stable id, e.g. 'grammar.case.dative'
    category          TEXT        NOT NULL,
    label_de          TEXT        NOT NULL,                 -- shown in UI
    label_en          TEXT        NOT NULL,
    default_severity  SMALLINT    NOT NULL DEFAULT 3,       -- 1..5, how much it hurts in a real interview
    attack_prompt     TEXT,                                 -- instruction the interview LLM uses to probe this
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT weakness_category_chk CHECK (
        category IN ('pronunciation','grammar','vocabulary','fluency','content','comprehension')
    ),
    CONSTRAINT weakness_severity_chk CHECK (default_severity BETWEEN 1 AND 5)
);


-- ------------------------------------------------------------
-- 2. Append-only error log. Source of truth. INSERT only, never UPDATE.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_events (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- ADAPT: user_id type must match your existing users PK (int / bigint / uuid / text).
    -- Confirm the real type before applying; change BIGINT below if needed.
    user_id       BIGINT      NOT NULL,

    session_id    TEXT,                                     -- group by practice session, if you have one
    phase         TEXT        NOT NULL,                     -- drill|shadow|chaos|live|interview
    error_key     TEXT        NOT NULL REFERENCES weakness_taxonomy(error_key),
    expected      TEXT,                                     -- known target (constrained phases)
    observed      TEXT,                                     -- what the student actually produced
    confidence    REAL        NOT NULL,                     -- 0..1  real error vs ASR artifact
    detection     TEXT        NOT NULL,                     -- exact_match_fail|llm_judge|phonetic_flag|rule
    confirmed     BOOLEAN     NOT NULL DEFAULT false,       -- second-pass confirmation (open phases)
    context_snip  TEXT,                                     -- surrounding text, for human review
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT phase_chk      CHECK (phase IN ('drill','shadow','chaos','live','interview')),
    CONSTRAINT confidence_chk CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_error_events_user
    ON error_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_user_key
    ON error_events (user_id, error_key);


-- ------------------------------------------------------------
-- 3. Rolled-up profile. One row per (student, weakness).
--    This is what the interview generator reads.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weakness_profile (
    user_id         BIGINT      NOT NULL,                   -- ADAPT: same type as above
    error_key       TEXT        NOT NULL REFERENCES weakness_taxonomy(error_key),
    occurrences     INTEGER     NOT NULL DEFAULT 0,         -- times missed
    weighted_score  REAL        NOT NULL DEFAULT 0,         -- sum(severity * confidence), decayed on clean passes
    clean_streak    SMALLINT    NOT NULL DEFAULT 0,         -- consecutive correct handles since last miss
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_phase      TEXT,
    status          TEXT        NOT NULL DEFAULT 'active',  -- active|improving|resolved
    PRIMARY KEY (user_id, error_key),
    CONSTRAINT status_chk CHECK (status IN ('active','improving','resolved'))
);

CREATE INDEX IF NOT EXISTS idx_weakness_profile_rank
    ON weakness_profile (user_id, status, weighted_score DESC);

COMMIT;


-- ====================  SEED TAXONOMY  =======================
-- Starter set tuned to Egyptian-Arabic -> German. Expand freely.
-- attack_prompt is filled for the high-value ones; add the rest as you go.

INSERT INTO weakness_taxonomy (error_key, category, label_de, label_en, default_severity, attack_prompt) VALUES
-- pronunciation (sounds Arabic L1 speakers commonly flatten in German)
('pron.umlaut.ue',        'pronunciation', 'ü-Laut',                 'ü vowel',                 3, 'Stelle Fragen mit ü-Wörtern (über, für, Würde, müssen). Achte darauf, ob das ü zu u/i abgeflacht wird.'),
('pron.umlaut.oe',        'pronunciation', 'ö-Laut',                 'ö vowel',                 3, 'Bring ö-Wörter ein (möchten, können, schön). Note if flattened to o/e.'),
('pron.ch.ich',           'pronunciation', 'ich-Laut',              'soft ch',                 3, 'Use ich-Laut words (ich, nicht, wichtig, möchte) and listen for a hard or sh-like substitution.'),
('pron.ch.ach',           'pronunciation', 'ach-Laut',              'hard ch',                 2, NULL),
('pron.p_b',              'pronunciation', 'p/b-Unterscheidung',    'p vs b',                  3, 'Arabic has no /p/. Use minimal pairs (Paar/Bar, Panne/Banane) and check for b-substitution.'),
('pron.v_w',              'pronunciation', 'v/w-Unterscheidung',    'v vs w',                  2, NULL),
('pron.r',                'pronunciation', 'r-Realisierung',        'German r',                2, NULL),

-- grammar
('grammar.gender.article','grammar',       'Artikel (der/die/das)', 'noun gender',             4, 'Ask questions whose answers force articles (Welche Abteilung? Welcher Vorgang?) and check der/die/das.'),
('grammar.case.accusative','grammar',      'Akkusativ',             'accusative case',         3, NULL),
('grammar.case.dative',   'grammar',       'Dativ',                 'dative case',             3, 'Ask something answered naturally with mit/bei/nach + dative (Mit wem haben Sie zusammengearbeitet?).'),
('grammar.word_order.v2', 'grammar',       'Verbzweitstellung',     'verb-second order',       4, 'Prompt longer statements; check the conjugated verb sits in position two.'),
('grammar.word_order.sub','grammar',       'Nebensatz-Endstellung', 'subordinate verb-final',  4, 'Ask a "weil/dass" question (Warum...?) and check the verb lands at the end.'),
('grammar.adj_ending',    'grammar',       'Adjektivendungen',      'adjective endings',       2, NULL),
('grammar.verb_conj',     'grammar',       'Verbkonjugation',       'verb conjugation',        3, NULL),
('grammar.separable_verb','grammar',       'Trennbare Verben',      'separable verbs',         2, NULL),

-- vocabulary / register
('vocab.bpo_term',        'vocabulary',    'BPO-Fachvokabular',     'missing BPO term',        3, 'Probe domain words (Erstlösungsquote, eskalieren, Vorgang, Anliegen). Note gaps or English fallback.'),
('vocab.false_friend',    'vocabulary',    'Falsche Freunde',       'false friend',            2, NULL),
('vocab.register',        'vocabulary',    'Register (Sie/förmlich)','formality register',     4, 'Watch for du or casual register where formal Sie is required; flag every slip.'),

-- fluency
('fluency.hesitation',    'fluency',       'Lange Pausen',          'long hesitation',         2, 'Apply mild time pressure; note pauses long enough to break the flow.'),
('fluency.filler',        'fluency',       'Füllwörter (ähm)',      'filler overuse',          1, NULL),
('fluency.abandon',       'fluency',       'Abgebrochene Sätze',    'abandoned sentence',      2, NULL),

-- content (interview substance — usually the highest-leverage)
('content.no_example',    'content',       'Kein konkretes Beispiel','no concrete example',    4, 'Refuse generalities. Demand: "Nennen Sie mir ein konkretes Beispiel." Do not move on until you get one.'),
('content.no_metrics',    'content',       'Kein messbares Ergebnis','no measurable outcome',  3, 'After any example, push: "Was war das konkrete Ergebnis? Mit Zahlen, bitte."'),
('content.company_unknown','content',      'Unternehmen unbekannt', 'employer unknown',        3, 'Ask what they know about the company; if vague, press on why they applied specifically here.'),
('content.deescalation',  'content',       'Schwache Deeskalation', 'weak de-escalation',      4, 'Throw an angry-customer line. Score whether they acknowledge, calm, and steer to a solution.'),
('content.unstructured',  'content',       'Unstrukturierte Antwort','unstructured answer',    2, NULL),
('content.motivation',    'content',       'Vage Motivation',       'vague motivation',        2, NULL),

-- comprehension
('comp.misunderstood',    'comprehension', 'Frage missverstanden',  'misunderstood question',  3, 'If an answer drifts, ask a sharper version of the same question and check comprehension.'),
('comp.off_topic',        'comprehension', 'Thema verfehlt',        'off-topic',               2, NULL)
ON CONFLICT (error_key) DO NOTHING;


-- ====================  QUERY REFERENCE  =====================
-- Wrap these three in JS helpers in the Node backend.
-- $-params are pg positional placeholders.

-- (A) RECORD AN ERROR  — run inside one transaction with the error_events INSERT.
--     $1 user_id  $2 error_key  $3 confidence (0..1)  $4 phase
--
--   INSERT INTO weakness_profile
--       (user_id, error_key, occurrences, weighted_score, last_seen, last_phase, status)
--   SELECT $1, $2, 1, (t.default_severity * $3), now(), $4, 'active'
--   FROM weakness_taxonomy t
--   WHERE t.error_key = $2
--   ON CONFLICT (user_id, error_key) DO UPDATE SET
--       occurrences    = weakness_profile.occurrences + 1,
--       weighted_score = weakness_profile.weighted_score + EXCLUDED.weighted_score,
--       clean_streak   = 0,
--       last_seen      = now(),
--       last_phase     = EXCLUDED.last_phase,
--       status         = 'active';
--
--   (and, in the same tx:)
--   INSERT INTO error_events
--       (user_id, session_id, phase, error_key, expected, observed, confidence, detection, confirmed, context_snip)
--   VALUES ($1, $5, $4, $2, $6, $7, $3, $8, $9, $10);


-- (B) RECORD A CLEAN PASS  — student handled a previously-weak area correctly.
--     $1 user_id  $2 error_key.  0.6 decay and streak>=3 -> resolved are KNOBS; tune them.
--
--   UPDATE weakness_profile SET
--       clean_streak   = clean_streak + 1,
--       weighted_score = weighted_score * 0.6,
--       status = CASE WHEN clean_streak + 1 >= 3 THEN 'resolved'
--                     WHEN clean_streak + 1 >= 1 THEN 'improving'
--                     ELSE status END
--   WHERE user_id = $1 AND error_key = $2;


-- (C) TOP WEAKNESSES FOR THE FINAL INTERVIEW.
--     $1 user_id  $2 limit (e.g. 5). Returns the attack prompts the interview should run.
--
--   SELECT p.error_key, t.category, t.label_de, t.attack_prompt, p.weighted_score
--   FROM weakness_profile p
--   JOIN weakness_taxonomy t ON t.error_key = p.error_key
--   WHERE p.user_id = $1 AND p.status <> 'resolved'
--   ORDER BY p.weighted_score DESC
--   LIMIT $2;


-- ====================  DOWN (rollback)  =====================
-- Run this block alone to fully reverse the migration.
--
--   BEGIN;
--   DROP TABLE IF EXISTS weakness_profile;
--   DROP TABLE IF EXISTS error_events;
--   DROP TABLE IF EXISTS weakness_taxonomy;
--   COMMIT;
