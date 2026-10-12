-- Version 3 Twin migration: slim `calls`, drop unused audit table.
-- Run once in Twin SQL console after backup. Safe to re-run (IF EXISTS).
-- Then run ../views.sql to recreate dashboard views.

DROP VIEW IF EXISTS v_followups;
DROP VIEW IF EXISTS v_kpi_summary;

ALTER TABLE calls DROP COLUMN IF EXISTS mc_locked;
ALTER TABLE calls DROP COLUMN IF EXISTS fmcsa_status;
ALTER TABLE calls DROP COLUMN IF EXISTS otp_status;
ALTER TABLE calls DROP COLUMN IF EXISTS rounds_used;
ALTER TABLE calls DROP COLUMN IF EXISTS standing_offer;
ALTER TABLE calls DROP COLUMN IF EXISTS loadboard_rate;
ALTER TABLE calls DROP COLUMN IF EXISTS outcome_reason;
ALTER TABLE calls DROP COLUMN IF EXISTS handoff_status;
ALTER TABLE calls DROP COLUMN IF EXISTS summary;
ALTER TABLE calls DROP COLUMN IF EXISTS notes;
ALTER TABLE calls DROP COLUMN IF EXISTS run_url;

DROP INDEX IF EXISTS idx_events_run;
DROP TABLE IF EXISTS call_events;

CREATE INDEX IF NOT EXISTS idx_offers_run_load_round ON offers (run_id, load_id, round);
