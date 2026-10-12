# OTP bridge flow (Version 3)

Reference for W2 tool wiring. Bridge owns crypto; Twin stores challenge state only.

## send_otp

1. **Read Twin** — `carrier_contacts.email` for verified `mc_number`.
2. **Webhook** — `POST /v1/otp/send` with `run_id`, `mc_number`, `email`, `resends`, optional `is_resend`.
3. **Write Twin** — upsert `otp_challenges` (`code_hash`, `salt`, `expires_at`, `masked_destination`, `resends`, `status` = `pending`).
4. **Send Email** — body uses hidden `otp_code` from webhook response (not in agent tool result).

## verify_otp

1. **Read Twin** — `otp_challenges` for `run_id`.
2. **Webhook** — `POST /v1/otp/verify` with hash, salt, expiry, attempts, caller `code`.
3. **Write Twin** — update `attempts`, `status` on `otp_challenges`.

Decide/book webhooks pass **`otp_challenge_status`** = `otp_challenges.status` (must be `passed` for TMS paths).

See [`docs/decisions.md`](../docs/decisions.md) D8 and [`W2-otp-send-verify.md`](./W2-otp-send-verify.md).
