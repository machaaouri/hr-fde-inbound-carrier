import type { BridgeConfig } from "../config/config.ts";
import { BridgeError } from "../http/errors.ts";

export const FMCSA_API_BASE = "https://mobile.fmcsa.dot.gov/qc/services";
export const FMCSA_RESPONSE_MS = 8_000;
export const FMCSA_FETCH_HEADERS: Record<string, string> = {
  Accept: "application/json",
};

export function isWebkeyNotFoundBody(body: unknown): boolean {
  if (body === null || typeof body !== "object") {
    return false;
  }
  const content = (body as Record<string, unknown>).content;
  return content === "Webkey not found";
}

export function readCarrierFromDocketBody(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const content = (body as Record<string, unknown>).content;

  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (first !== null && typeof first === "object") {
      const row = first as Record<string, unknown>;
      if (row.carrier && typeof row.carrier === "object") {
        return row.carrier as Record<string, unknown>;
      }
      return row;
    }
    return null;
  }

  if (content !== null && typeof content === "object") {
    const c = content as Record<string, unknown>;
    const carrier = c.carrier;
    if (carrier !== null && typeof carrier === "object") {
      return carrier as Record<string, unknown>;
    }
  }

  return null;
}

export function readCarrierAuthorityRows(body: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  if (body === null || typeof body !== "object") {
    return rows;
  }
  const content = (body as Record<string, unknown>).content;

  if (Array.isArray(content)) {
    for (const item of content) {
      if (item === null || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const authority = row.carrierAuthority;
      if (authority !== null && typeof authority === "object") {
        rows.push(authority as Record<string, unknown>);
      }
    }
    return rows;
  }

  if (content !== null && typeof content === "object") {
    const c = content as Record<string, unknown>;
    const authority = c.carrierAuthority;
    if (Array.isArray(authority)) {
      for (const row of authority) {
        if (row && typeof row === "object") {
          rows.push(row as Record<string, unknown>);
        }
      }
    } else if (authority !== null && typeof authority === "object") {
      rows.push(authority as Record<string, unknown>);
    }
    const authorities = c.authorities;
    if (Array.isArray(authorities)) {
      for (const row of authorities) {
        if (row && typeof row === "object") {
          rows.push(row as Record<string, unknown>);
        }
      }
    }
  }

  return rows;
}

export type FmcsaClientOptions = {
  webKey: string;
  fetchImpl?: typeof fetch;
  responseMs?: number;
};

export class FmcsaClient {
  private readonly webKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly responseMs: number;

  constructor(options: FmcsaClientOptions) {
    this.webKey = options.webKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.responseMs = options.responseMs ?? FMCSA_RESPONSE_MS;
  }

  static fromConfig(config: BridgeConfig): FmcsaClient {
    return new FmcsaClient({ webKey: config.fmcsaApiKey });
  }

  async lookupByMcDocket(docketDigits: string): Promise<{
    carrier: Record<string, unknown>;
    authorityRows: Record<string, unknown>[];
  } | null> {
    const docketUrl = `${FMCSA_API_BASE}/carriers/docket-number/${encodeURIComponent(docketDigits)}?webKey=${encodeURIComponent(this.webKey)}`;
    const docketJson = await this.getJson(docketUrl, "FMCSA_DOCKET");
    const carrier = readCarrierFromDocketBody(docketJson);
    if (!carrier) {
      return null;
    }

    const dotRaw = carrier.dotNumber ?? carrier.dot;
    const dot =
      typeof dotRaw === "number"
        ? dotRaw
        : typeof dotRaw === "string"
          ? Number.parseInt(dotRaw, 10)
          : NaN;
    if (!Number.isFinite(dot)) {
      throw new BridgeError(
        "FMCSA_UNAVAILABLE",
        "FMCSA returned carrier without DOT number",
        503,
        true,
      );
    }

    const authorityUrl = `${FMCSA_API_BASE}/carriers/${dot}/authority?webKey=${encodeURIComponent(this.webKey)}`;
    let authorityRows: Record<string, unknown>[] = [];
    try {
      const authorityJson = await this.getJson(authorityUrl, "FMCSA_AUTHORITY");
      authorityRows = readCarrierAuthorityRows(authorityJson);
    } catch (err) {
      if (err instanceof BridgeError) {
        throw err;
      }
      throw new BridgeError(
        "FMCSA_UNAVAILABLE",
        "FMCSA authority lookup failed",
        503,
        true,
      );
    }

    return { carrier, authorityRows };
  }

  private async getJson(url: string, label: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.responseMs);
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: FMCSA_FETCH_HEADERS,
      });
      const text = await res.text();
      let body: unknown = null;
      if (text.trim() !== "") {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          if (!res.ok) {
            throw fmcsaUnavailable(`FMCSA ${label} HTTP ${res.status} (non-JSON)`);
          }
          throw fmcsaUnavailable(`FMCSA ${label} returned non-JSON`);
        }
      }

      if (!res.ok) {
        if (res.status === 404 && isWebkeyNotFoundBody(body)) {
          throw fmcsaMisconfigured("FMCSA webKey not found — check FMCSA_API_KEY");
        }
        if (res.status === 403 && text.includes("403 Forbidden")) {
          throw fmcsaUnavailable(
            `FMCSA ${label} HTTP 403 (likely geo/VPN egress block)`,
          );
        }
        throw fmcsaUnavailable(`FMCSA ${label} HTTP ${res.status}`);
      }

      return body;
    } catch (err) {
      if (err instanceof BridgeError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw fmcsaUnavailable(`${label}: timeout after ${this.responseMs}ms`);
      }
      throw fmcsaUnavailable(
        err instanceof Error ? err.message : `${label}: request failed`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function fmcsaUnavailable(message: string): BridgeError {
  return new BridgeError("FMCSA_UNAVAILABLE", message, 503, true);
}

function fmcsaMisconfigured(message: string): BridgeError {
  return new BridgeError("FMCSA_MISCONFIGURED", message, 503, false);
}
