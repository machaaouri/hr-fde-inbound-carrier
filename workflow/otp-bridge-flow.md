# OTP tools (bridge + Twin + Send Email) — W2+

No Custom Code. Crypto runs on the bridge; Twin and email stay on HappyRobot.

**Webhook wiring:** `@BRIDGE_BASE_URL` + path; **Bearer Token** → `@BRIDGE_API_KEY`; Fixed `run_id` → `@current.run_id`. Open **Tool Call Result** once per tool before publish.

## `send_otp`

1. **Read Twin** — `carrier_contacts` by `mc_number`; optional FMCSA email path per env `OTP_FMCSA_FALLBACK`.
2. **Condition** — email present; else end call `otp_failed` / `no_contact_on_file`.
3. **Webhook** — `POST` `@BRIDGE_BASE_URL` + `/v1/otp/send`  
   Body (fixed/hidden where noted): `run_id`, `mc_number`, `email`, `resends`, `is_resend`.
4. **Write Twin** — upsert `otp_challenges` (`code_hash`, `salt`, `expires_at`, `masked_destination`, `resends`, `status=pending`).
5. **Send Email** — To = same `email` (fixed); body uses webhook **`otp_code`** (**hidden** from agent Tool Call Result).
6. **Write Twin** — `calls.otp_status`, `call_events`.
7. **Tool Call Result (agent-visible):** `sent`, `masked_destination` only — not `otp_code`.

## `verify_otp`

1. **Read Twin** — `otp_challenges` + `calls` for `run_id`.
2. **Webhook** — `POST` `@BRIDGE_BASE_URL` + `/v1/otp/verify` with challenge fields + tool param `code`.
3. **Write Twin** — update `attempts`, `status`; on `result=passed` set `mc_locked=true`, `otp_status=passed`.
4. **Tool Call Result (agent-visible):** `result`, `attempts_left` only.

Live handlers: `POST /v1/otp/send` and `/v1/otp/verify` on the bridge (step 3). Platform wiring: `workflow/W2-otp-send-verify.md`.
