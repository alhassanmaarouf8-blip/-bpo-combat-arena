-- callfloor_schema.sql — Mode 2 (Call Floor) tables. ADDITIVE ONLY: every statement is
-- CREATE ... IF NOT EXISTS; no existing table is altered, no column is added anywhere else.
-- Applied idempotently on boot by server/callfloor/db.js (isolated — a failure here can never
-- affect Mode 1). Same doctrine as weakness_db_schema.sql.

BEGIN;

-- Every AI call's cost, one row per call. usd_list = paid list rate (the margin engine's truth);
-- usd_actual = what we actually pay today (mostly 0 on free tiers). measured=false marks
-- backfilled/estimated rows so real telemetry is never diluted by reconstruction.
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id          bigserial   PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  user_id     text        NOT NULL,
  feature     text        NOT NULL,   -- e.g. 'interview-voice', 'deep-analysis', 'callfloor-persona'
  provider    text        NOT NULL,   -- e.g. 'groq', 'deepgram'
  model       text        NOT NULL,
  unit_type   text        NOT NULL,   -- 'tokens' | 'seconds' | 'chars' | 'requests'
  units_in    numeric     NOT NULL DEFAULT 0,
  units_out   numeric     NOT NULL DEFAULT 0,
  usd_actual  numeric     NOT NULL DEFAULT 0,
  usd_list    numeric     NOT NULL DEFAULT 0,
  measured    boolean     NOT NULL DEFAULT true,
  meta        jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts    ON ai_usage_events (user_id, ts);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_ts ON ai_usage_events (feature, ts);

-- Phase 2: one row per finished (or abandoned) call. The transcript is persisted HERE the moment
-- the call ends (pipeline-audit law: transcripts must never die with the connection), so the
-- post-call language analysis can retry from durable state.
CREATE TABLE IF NOT EXISTS call_sessions (
  id              text        PRIMARY KEY,
  user_id         text        NOT NULL,
  quadrant        text        NOT NULL,   -- inbound_cs | inbound_sales | outbound_cs | outbound_sales
  scenario_id     text        NOT NULL,
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  status          text        NOT NULL,   -- live | ended | abandoned
  analysis_status text        NOT NULL DEFAULT 'pending',  -- pending | ready | failed
  transcript      jsonb,
  cairo_day       text        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_sessions_user_day ON call_sessions (user_id, cairo_day);

-- Phase 2: the job-competency verdict per call (the language errors live in error_events via the
-- frozen pipeline — never duplicated here).
CREATE TABLE IF NOT EXISTS call_results (
  id                 bigserial   PRIMARY KEY,
  session_id         text        NOT NULL,
  user_id            text        NOT NULL,
  quadrant           text        NOT NULL,
  scenario_id        text        NOT NULL,
  handle_seconds     integer     NOT NULL DEFAULT 0,
  satisfaction_final integer,               -- persona's own last self-reported mood 1-5
  resolved           boolean,               -- null = honestly not judgeable
  skills             jsonb,                 -- [{key, score, quote}] — quotes verbatim-verified
  meta               jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_results_user ON call_results (user_id, created_at);

COMMIT;
