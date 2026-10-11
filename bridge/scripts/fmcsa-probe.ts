/**
 * FMCSA QCMobile probe: docket + authority for a sample MC.
 * Writes JSON to stdout (redirect to docs/fmcsa-probe-results.json). Never prints webKey.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  FMCSA_API_BASE,
  FMCSA_FETCH_HEADERS,
  FMCSA_RESPONSE_MS,
} from "../src/fmcsa/constants.ts";
import {
  readCarrierAuthorityRows,
  readCarrierFromDocketBody,
} from "../src/fmcsa/parse-json.ts";
import { normalizeMcDocket } from "../src/fmcsa/normalize-mc.ts";
import { evaluateCarrierEligibility } from "../src/fmcsa/evaluate-eligibility.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(repoRoot, ".env") });

const webKey = process.env.FMCSA_API_KEY?.trim();
const mcRaw = process.env.FMCSA_PROBE_MC?.trim() ?? "136818";

function logStep(message: string): void {
  console.error(`[fmcsa-probe] ${message}`);
}

function redactDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && /webkey|api[_-]?key/i.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/webkey|api[_-]?key|secret/i.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactDeep(v);
    }
  }
  return out;
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FMCSA_RESPONSE_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: FMCSA_FETCH_HEADERS,
    });
    const text = await res.text();
    let body: unknown = null;
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { _parseError: true, rawPreview: text.slice(0, 200) };
      }
    }
    return { status: res.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  if (!webKey) {
    console.error("Missing FMCSA_API_KEY. Copy .env.example to .env and fill FMCSA_API_KEY.");
    process.exit(1);
  }

  const docket = normalizeMcDocket(mcRaw);
  if (!docket) {
    console.error(`Invalid FMCSA_PROBE_MC: ${mcRaw}`);
    process.exit(1);
  }

  const docketPathCandidates = [docket, `MC${docket}`];
  const docketAttempts: { path: string; http_status: number }[] = [];
  let docketRes: { status: number; body: unknown; text: string } | null = null;
  let docketPathUsed: string | null = null;

  for (const candidate of docketPathCandidates) {
    const path = `/carriers/docket-number/${encodeURIComponent(candidate)}`;
    logStep(`docket lookup ${candidate}`);
    const url = `${FMCSA_API_BASE}${path}?webKey=${encodeURIComponent(webKey)}`;
    const res = await fetchJson(url);
    docketAttempts.push({ path: candidate, http_status: res.status });
    if (res.status === 200 && readCarrierFromDocketBody(res.body) !== null) {
      docketRes = res;
      docketPathUsed = candidate;
      break;
    }
    if (docketRes === null) {
      docketRes = res;
      docketPathUsed = candidate;
    }
  }

  const docketUrl =
    docketPathUsed !== null
      ? `${FMCSA_API_BASE}/carriers/docket-number/${encodeURIComponent(docketPathUsed)}?webKey=[REDACTED]`
      : null;

  const carrier = docketRes ? readCarrierFromDocketBody(docketRes.body) : null;
  const dotRaw = carrier?.dotNumber ?? carrier?.dot;
  const dot =
    typeof dotRaw === "number"
      ? dotRaw
      : typeof dotRaw === "string"
        ? Number.parseInt(dotRaw, 10)
        : NaN;

  let authorityRes: { status: number; body: unknown; text: string } | null = null;
  let authorityPath: string | null = null;
  if (Number.isFinite(dot)) {
    logStep(`authority lookup DOT ${dot}`);
    authorityPath = `/carriers/${dot}/authority`;
    const authorityFetchUrl = `${FMCSA_API_BASE}${authorityPath}?webKey=${encodeURIComponent(webKey)}`;
    authorityRes = await fetchJson(authorityFetchUrl);
  }

  const authorityRows = authorityRes
    ? readCarrierAuthorityRows(authorityRes.body)
    : [];
  const bridgeEval =
    carrier !== null
      ? evaluateCarrierEligibility(carrier, authorityRows)
      : null;

  const probeOk =
    docketRes !== null && docketRes.status === 200 && carrier !== null;

  let edgeBlockHint: string | null = null;
  if (!probeOk && docketRes?.status === 403) {
    const decoyUrl = `${FMCSA_API_BASE}/carriers/docket-number/${encodeURIComponent(docket)}?webKey=fake-key-on-purpose`;
    const decoy = await fetchJson(decoyUrl);
    const decoyHtml =
      typeof decoy.text === "string" && decoy.text.includes("403 Forbidden");
    if (decoy.status === 403 && decoyHtml) {
      edgeBlockHint =
        "403 HTML on real and decoy webKey — likely geo/VPN/egress block, not a bad key (API would return 404 JSON for invalid webKey). See docs/fmcsa-handbook-notes.md#troubleshooting";
    }
  }

  const report = {
    probed_at: new Date().toISOString(),
    probe_ok: probeOk,
    fmcsa_api_key_configured: webKey.length > 0,
    mc_input: mcRaw,
    mc_docket_digits: docket,
    docket_paths_tried: docketAttempts,
    docket_request: docketUrl,
    docket_http_status: docketRes?.status ?? null,
    docket_body: docketRes ? redactDeep(docketRes.body) : null,
    carrier_parsed: carrier ? redactDeep(carrier) : null,
    dot_number: Number.isFinite(dot) ? dot : null,
    authority_request:
      authorityPath !== null
        ? `${FMCSA_API_BASE}${authorityPath}?webKey=[REDACTED]`
        : null,
    authority_http_status: authorityRes?.status ?? null,
    authority_body: authorityRes ? redactDeep(authorityRes.body) : null,
    authority_rows_parsed: authorityRows.length,
    bridge_eligibility_preview: bridgeEval,
    fields_read_by_bridge: {
      docket: [
        "content[].carrier",
        "allowedToOperate",
        "commonAuthorityStatus",
        "contractAuthorityStatus",
        "oosDate",
        "dotNumber",
        "legalName",
        "emailAddress | email | emailAddr (optional)",
      ],
      authority: [
        "content[].carrierAuthority",
        "commonAuthorityStatus",
        "contractAuthorityStatus",
        "brokerAuthorityStatus (informational)",
      ],
    },
    official_docs: "https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi",
    fixture_contract: "docs/fmcsa-fixtures/*.json (used when probe_ok is false or offline)",
    likely_cause_hint: edgeBlockHint,
    note: probeOk
      ? "Live FMCSA snapshot. Re-run: make probe-fmcsa"
      : edgeBlockHint ??
        "Live probe did not return a carrier. See docs/fmcsa-handbook-notes.md#troubleshooting. Schema reference: docs/fmcsa-fixtures/",
  };

  if (!probeOk) {
    logStep(
      `probe failed (last HTTP ${docketRes?.status ?? "n/a"}). See docs/fmcsa-handbook-notes.md#troubleshooting`,
    );
    process.exitCode = 1;
  }

  const outPath = resolve(repoRoot, "docs/fmcsa-probe-results.json");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(outPath, json, "utf8");
  process.stdout.write(json);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
