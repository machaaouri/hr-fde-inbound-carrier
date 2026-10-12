-- KPI and follow-up views (read-only for Ops App). Version 3 columns only.

CREATE OR REPLACE VIEW v_kpi_summary AS
WITH base AS (
  SELECT *
  FROM calls
  WHERE outcome <> 'abandoned' OR mc_number IS NOT NULL
),
verified AS (
  SELECT * FROM base WHERE fmcsa_eligible IS TRUE
),
matched AS (
  SELECT * FROM verified WHERE current_load_id IS NOT NULL AND outcome NOT IN ('no_match')
),
offer_rounds AS (
  SELECT run_id, load_id, MAX(round) AS max_round
  FROM offers
  GROUP BY run_id, load_id
),
opening_offers AS (
  SELECT DISTINCT ON (run_id, load_id)
    run_id,
    load_id,
    broker_offer AS opening_broker_offer
  FROM offers
  WHERE decision = 'OPENING' AND broker_offer IS NOT NULL
  ORDER BY run_id, load_id, created_at ASC
)
SELECT
  (SELECT COUNT(*) FROM base) AS total_calls,
  (SELECT COUNT(*) FROM verified) AS fmcsa_passed,
  (SELECT COUNT(*) FROM base WHERE outcome = 'fmcsa_failed') AS fmcsa_failed,
  (SELECT COUNT(*)
   FROM verified v
   INNER JOIN otp_challenges oc ON oc.run_id = v.run_id AND oc.status = 'passed') AS otp_passed,
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
  (SELECT ROUND(AVG(max_round)::numeric, 2) FROM offer_rounds WHERE max_round > 0) AS avg_negotiation_rounds,
  (SELECT ROUND(AVG(c.agreed_rate - oo.opening_broker_offer)::numeric, 2)
   FROM base c
   INNER JOIN opening_offers oo ON oo.run_id = c.run_id AND oo.load_id = c.current_load_id
   WHERE c.outcome = 'booked'
     AND c.agreed_rate IS NOT NULL
     AND oo.opening_broker_offer IS NOT NULL) AS avg_agreed_minus_opening_offer,
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
  CASE
    WHEN outcome = 'booked' AND (booking_ref IS NULL OR booking_ref = '')
      THEN 'booked_missing_ref'
    WHEN outcome = 'booking_failed' THEN 'booking_failed'
    WHEN outcome = 'system_error' THEN 'system_error'
    WHEN outcome = 'otp_failed' THEN 'otp_failed'
    ELSE NULL
  END AS followup_type
FROM calls
WHERE
  (outcome = 'booked' AND (booking_ref IS NULL OR booking_ref = ''))
  OR outcome IN ('booking_failed', 'system_error', 'otp_failed');
