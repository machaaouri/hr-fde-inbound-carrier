-- KPI and follow-up views (read-only for Ops App).

CREATE OR REPLACE VIEW v_kpi_summary AS
WITH base AS (
  SELECT *
  FROM calls
  WHERE outcome <> 'abandoned' OR mc_number IS NOT NULL
),
verified AS (
  SELECT * FROM base WHERE fmcsa_status = 'passed'
),
matched AS (
  SELECT * FROM verified WHERE current_load_id IS NOT NULL AND outcome NOT IN ('no_match')
)
SELECT
  (SELECT COUNT(*) FROM base) AS total_calls,
  (SELECT COUNT(*) FROM verified) AS fmcsa_passed,
  (SELECT COUNT(*) FROM base WHERE outcome = 'fmcsa_failed') AS fmcsa_failed,
  (SELECT COUNT(*) FROM verified WHERE otp_status = 'passed') AS otp_passed,
  (SELECT COUNT(*) FROM verified WHERE outcome = 'otp_failed') AS otp_failed,
  (SELECT COUNT(*) FROM verified WHERE outcome = 'no_match') AS no_match,
  (SELECT COUNT(*) FROM matched) AS matched_calls,
  (SELECT COUNT(*) FROM base WHERE outcome = 'booked') AS booked,
  (SELECT COUNT(*) FROM base WHERE outcome = 'failed_negotiation') AS failed_negotiation,
  (SELECT COUNT(*) FROM base WHERE outcome = 'booking_failed') AS booking_failed,
  (SELECT COUNT(*) FROM base WHERE outcome = 'system_error') AS system_error,
  CASE
    WHEN (SELECT COUNT(*) FROM matched) = 0 THEN NULL
    ELSE ROUND(
      100.0 * (SELECT COUNT(*) FROM base WHERE outcome = 'booked')
      / NULLIF((SELECT COUNT(*) FROM matched), 0),
      2
    )
  END AS booking_rate_pct,
  (SELECT ROUND(AVG(rounds_used)::numeric, 2) FROM base WHERE rounds_used > 0) AS avg_negotiation_rounds,
  (SELECT ROUND(AVG(agreed_rate - loadboard_rate)::numeric, 2)
   FROM base
   WHERE outcome = 'booked' AND agreed_rate IS NOT NULL AND loadboard_rate IS NOT NULL) AS avg_agreed_minus_loadboard,
  (SELECT COUNT(*) FROM base WHERE outcome = 'system_error') * 100.0
    / NULLIF((SELECT COUNT(*) FROM base), 0) AS system_error_rate_pct;

CREATE OR REPLACE VIEW v_followups AS
SELECT
  run_id,
  env,
  started_at,
  mc_number,
  carrier_name,
  current_load_id,
  agreed_rate,
  booking_ref,
  outcome,
  outcome_reason,
  handoff_status,
  summary,
  run_url,
  CASE
    WHEN outcome = 'booked' AND (handoff_status IS NULL OR handoff_status <> 'handled')
      THEN 'booked_awaiting_rep'
    WHEN outcome = 'booked' AND (booking_ref IS NULL OR booking_ref = '')
      THEN 'booked_missing_ref'
    WHEN outcome = 'booking_failed' THEN 'booking_failed'
    WHEN outcome = 'system_error' THEN 'system_error'
    WHEN outcome = 'otp_failed' AND outcome_reason = 'no_contact_on_file'
      THEN 'otp_no_contact'
    WHEN outcome = 'otp_failed' THEN 'otp_failed'
    ELSE NULL
  END AS followup_type
FROM calls
WHERE
  (outcome = 'booked' AND (handoff_status IS NULL OR handoff_status <> 'handled'))
  OR (outcome = 'booked' AND (booking_ref IS NULL OR booking_ref = ''))
  OR outcome IN ('booking_failed', 'system_error', 'otp_failed');
