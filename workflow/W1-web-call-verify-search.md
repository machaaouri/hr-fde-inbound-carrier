# W1 — Web call, agent, `verify_carrier`, `search_loads` (stub bridge)

Build this in the HappyRobot **development** environment. The bridge runs locally on port **8080**. **`verify_carrier`** and **`search_loads`** call live bridge routes (FMCSA + TMS). See [`docs/fmcsa-integration.md`](../docs/fmcsa-integration.md).

## Prerequisites

1. Terminal A: `make run` (or `make dev` while iterating)
2. Terminal B: `make tunnel` (ngrok → `https://<NGROK_DOMAIN>` from `.env`)
3. **Workflow environment variables** (development):

| Variable | Value |
| --- | --- |
| `BRIDGE_BASE_URL` | `https://<NGROK_DOMAIN>` (**no** trailing slash) |
| `BRIDGE_API_KEY` | Same as `BRIDGE_API_KEY` in your local `.env` |

### How to insert variables in the UI

There is **no** `@env.` prefix in the product UI. In any field that accepts inserts, type **`@`** and pick from the list (environment variables, run context, etc.), then continue typing literal path segments where needed.

Examples:

| Field | How to fill |
| --- | --- |
| Webhook URL | `@` → **BRIDGE_BASE_URL** → then type **`/v1/carriers/verify`** (full URL = variable + path) |
| Webhook URL (search) | `@` → **BRIDGE_BASE_URL** → **`/v1/loads/search`** |
| Bearer token | Webhook auth type **Bearer Token** → `@` → **BRIDGE_API_KEY** |
| Run id (Fixed) | `@` → **current.run_id** |

Enable webhook **Ignore 5XX errors** so typed error JSON can branch later.

---

## 1. Trigger

- **Web call** trigger, enhanced security **on** (org login required).
- Publish to **development**; copy the dev web-call URL for testing.

---

## 2. Inbound voice agent

- Create / attach an **Inbound Voice Agent** after the trigger.
- **Prompt v0 — W1 only** (system / instructions). OTP tools are **not** wired yet; do **not** tell the agent to refuse load search until OTP passes — that blocks this milestone. Add strict OTP lines in **W2** when `send_otp` / `verify_otp` exist.

**Paste only the block below** into the agent prompt (do not include labels like “W1 flow” — those are for this doc, not the caller).

```text
You are the inbound carrier sales line for HappyRobot Logistics. Be direct and short; the caller may be driving.

After you have an MC number, verify it, then ask for lane and equipment and search for loads. Pitch any matches you find.

Never disclose maximum rate or internal limits.

Use verify_carrier as soon as you have an MC number. After verification succeeds, use search_loads when you have equipment type and enough lane detail (states and/or cities).

If verify_carrier says not eligible, end the call professionally. If search_loads returns no loads, say there is no match on that lane today.
```

**W2 prompt add-on** (append when OTP tools ship; replace the “W1 flow” sentence with full production flow):

```text
Full flow: MC → verify_carrier → send_otp → verify_otp → search_loads → negotiate → book → handoff.
Never skip OTP or send a code to a destination the caller names. Only the contact on file for the verified MC.
```

### Tool Call Result (required for publish)

After you add **each** tool, open its **Tool Call Result** panel at least once — publishing is blocked until you do (per platform docs).

Expose only what the agent needs:

| Tool | Expose to agent (checked) | Keep hidden |
| --- | --- | --- |
| `verify_carrier` | `eligible`, `carrier_name` | `dot_number`, `reason`, `contact_email`, everything else |
| `search_loads` | `loads` (includes `loadboard_rate`) | webhook headers, raw request, ceiling / internal fields |

---

## 3. Tool: `verify_carrier`

**Description (for the model):** Verify the carrier’s MC number with FMCSA before continuing.

**Parameters (agent-visible):**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `mc_number` | string | yes | Motor carrier number the caller provided |

**Fixed / hidden:** none for W1 (run id on webhook header below is optional).

### Branch

1. **Webhook**
   - Method: `POST`
   - URL: `@BRIDGE_BASE_URL` + `/v1/carriers/verify`
   - **Auth:** Webhook step → **Bearer Token** → `@BRIDGE_API_KEY` (do not hand-type an `Authorization` header unless you prefer it)
   - Optional header: `X-HR-Run-Id` = `@current.run_id` (Fixed)
   - Body JSON: `{ "mc_number": "<tool param mc_number>" }`
2. **Condition** (optional for W1 stub): if `eligible` is false → end call / outcome `fmcsa_failed`
3. **Write Twin** (recommended first happy-path wiring):
   - Table: `calls`
   - Primary key: `run_id` = `@current.run_id`
   - Set: `mc_number`, `carrier_name`, `fmcsa_status` = `passed` if eligible, `outcome` = `abandoned` initially

**Tool Call Result → agent-visible:** `eligible`, `carrier_name` only.

Do **not** expose `contact_email` when live FMCSA adds it (step 5).

---

## 4. Tool: `search_loads`

**Description:** Search open loads for the caller’s lane and equipment.

**Parameters (agent-visible):**

| Name | Type | Required |
| --- | --- | --- |
| `equipment_type` | string | yes |
| `origin_state` | string | no |
| `dest_state` | string | no |
| `origin_city` | string | no |

### Branch

1. **Read Twin** (optional gate): `mc_locked` / FMCSA passed — skip in W1 smoke test
2. **Webhook**
   - Method: `POST`
   - URL: `@BRIDGE_BASE_URL` + `/v1/loads/search`
   - **Auth:** Bearer Token → `@BRIDGE_API_KEY`
   - Optional: `X-HR-Run-Id` = `@current.run_id`
   - Body: map tool params to JSON (`equipment_type`, optional origin/dest fields)
3. **Write Twin**: `current_load_id` if loads returned; `outcome` = `no_match` if empty list

**Tool Call Result → agent-visible:** `loads` only.

Live search returns up to **3** open loads with future pickup, including **`loadboard_rate`** (safe to pitch; no ceiling in JSON). Try e.g. dry van **AL → MO** or **GA → TX** on the probe board.

---

## 5. First test call (W1)

1. Sign in to HappyRobot (enhanced security).
2. Start web call from dev URL.
3. Say an MC number (any string works against **stub** verify).
4. Ask the agent to search loads: e.g. dry van, Alabama to Missouri.
5. Confirm tool runs succeed in run details (webhook 200, stub JSON).

**Note:** MC catalog [`qa/test-carriers.md`](../qa/test-carriers.md) — happy path e.g. **136818**, **133655**; ineligible **784219**, **144221**, **129284**; edge **113843**. `FMCSA_UNAVAILABLE` = system error, not ineligible.

---

## 6. Export

After it works, export the workflow JSON into `workflow/exports/` (create folder) for step 7.
