-- Twin schema for inbound carrier sales (D5).
-- Run in the HappyRobot Twin SQL console. Dollars as BIGINT whole USD. MAX_BUY is never stored.

CREATE TABLE IF NOT EXISTS carrier_contacts (
  mc_number   TEXT PRIMARY KEY,
  legal_name  TEXT NOT NULL,
  email       TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('seed', 'fmcsa')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calls (
  run_id           TEXT PRIMARY KEY,
  env              TEXT NOT NULL DEFAULT 'development',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  mc_number        TEXT,
  mc_locked        BOOLEAN NOT NULL DEFAULT FALSE,
  carrier_name     TEXT,
  dot_number       TEXT,
  fmcsa_eligible   BOOLEAN,
  fmcsa_reason     TEXT,
  fmcsa_status     TEXT,          -- deprecated: not written by Version 2 workflow
  otp_status       TEXT,
  current_load_id  TEXT,
  rounds_used      INT NOT NULL DEFAULT 0,
  standing_offer   BIGINT,
  agreed_rate      BIGINT,
  loadboard_rate   BIGINT,        -- deprecated: not written by Version 2 workflow
  outcome          TEXT NOT NULL DEFAULT 'abandoned',
  outcome_reason   TEXT,          -- deprecated: not written by Version 2 workflow
  booking_ref      TEXT,
  handoff_status   TEXT,          -- deprecated: not written by Version 2 workflow
  summary          TEXT,          -- deprecated: not written by Version 2 workflow
  notes            TEXT,          -- deprecated: not written by Version 2 workflow
  run_url          TEXT             -- deprecated: not written by Version 2 workflow
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  run_id              TEXT PRIMARY KEY,
  mc_number           TEXT NOT NULL,
  masked_destination  TEXT NOT NULL,
  code_hash           TEXT NOT NULL,
  salt                TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  attempts            INT NOT NULL DEFAULT 0,
  resends             INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS offers (
  id               BIGSERIAL PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES calls (run_id) ON DELETE CASCADE,
  load_id          TEXT NOT NULL,
  round            INT NOT NULL,
  carrier_counter  BIGINT,
  broker_offer     BIGINT,
  decision         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_events (
  id       BIGSERIAL PRIMARY KEY,
  run_id   TEXT NOT NULL REFERENCES calls (run_id) ON DELETE CASCADE,
  ts       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type     TEXT NOT NULL,
  payload  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_calls_outcome ON calls (outcome);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_run ON offers (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run ON call_events (run_id, ts);
