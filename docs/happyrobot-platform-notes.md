# HappyRobot platform notes (for inbound carrier build)

Access: [HappyRobot docs](https://docs.happyrobot.ai) (access code `oshappyrobot`). Index: `/llms.txt`; pages as `/<path>.md` from an unlocked browser session.

These notes answer open questions Q1–Q5 in `PROBLEM_BRIEF.md` and drive workflow design (D6, D8).

## Q1 — Custom Code and Twin

- Custom Code runs in a **Python sandbox with no network** (optional; we are **not** using it for OTP).
- **Read Twin / Write Twin** are separate built-in nodes — the workflow writes `otp_challenges` and `calls` without Custom Code.

**Decision (updated):** OTP generate/verify live on the **bridge** (`/v1/otp/send`, `/v1/otp/verify`). Workflow: Read Twin → Webhook → Write Twin → Send Email on send; Read Twin → Webhook → Write Twin on verify.

## Q2 — Outbound SMS vs email

- Docs show no one-shot SMS action (SMS appears as Twilio **text agent**, not a single send node).
- **Send Email** is a one-shot action.

**Decision:** OTP delivery via **email** to the contact on file.

## Q3 — Webhooks, secrets, and hidden fields

- **Variable inserts:** type **`@`** in a field and pick from the list (e.g. `BRIDGE_BASE_URL`, `BRIDGE_API_KEY`, `current.run_id`). There is **no** `@env.` prefix in the UI. For URLs: pick `BRIDGE_BASE_URL`, then type the path (`/v1/carriers/verify`).
- **Webhook auth:** use the step’s built-in **Bearer Token** auth with `@BRIDGE_API_KEY` rather than typing an `Authorization` header manually.
- Tool parameters can be **Fixed value** (hidden from the model).
- **Tool Call Result:** open the panel at least **once per tool** before publish (platform requirement). Fields start hidden; only tick fields the agent may see.

**Decision:** expose minimal tool outputs; secrets and ceiling stay in Fixed values / hidden webhook fields.

## Q4 — Twin read/write

- **Write Twin** upserts on primary key.
- **Query Twin with SQL** is read-only and parameterized.
- Latency is **not documented** — measure on first Twin use (step 1 / first tool call).

## Q5 — Post-call on web calls

- Run dumps may only fire for **completed** runs (still unverified for web call trigger).
- **Fallback:** write outcome during the call via tools; post-call summary/notes are best effort.

## Workflow facts used in D6

- **Web call trigger:** “Enhanced security” defaults **on** (requires HappyRobot login). Separate URLs per environment (development, staging, production).
- **Webhook:** “Ignore 5XX errors” allows typed error JSON to reach branch conditions instead of failing the node.
- **Tools (8):** `verify_carrier`, `send_otp`, `verify_otp`, `search_loads`, `negotiate`, `accept_offer`, `book_load`, `end_call(outcome_hint)`.
- **Branch pattern:** Read Twin → Condition gate → Webhook or Custom Code → Write Twin.
- **Environments:** separate dev/prod `BRIDGE_BASE_URL` and API keys; ngrok static domain for local dev (see `.env.example`).

## OTP residual exposure (D8)

OTP plaintext may appear in run details (webhook response mapped to Send Email, etc.) to platform users with run access. It does **not** enter the agent context if Tool Call Result hides `otp_code`.

## Apps / Twin from browser

HappyRobot Apps must **not** call Twin from the client. Ops App uses server-side routes only (step 8).
