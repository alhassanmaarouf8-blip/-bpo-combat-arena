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

COMMIT;
