import { createConnection, type Socket } from "node:net";
import type { BridgeConfig } from "../config/config.ts";
import { BridgeError } from "../http/errors.ts";
import { addTmsDuration } from "../http/logging.ts";
import {
  TMS_CONNECT_MS,
  TMS_MAX_FRAME_BYTES,
  TMS_READ_BACKOFF_MS,
  TMS_READ_MAX_ATTEMPTS,
  TMS_RESPONSE_MS,
  bridgeErrorFromTmsWire,
  parseTmsResponse,
} from "./protocol.ts";
import type { ParsedTmsResponse } from "./types.ts";

export type TmsClientOptions = {
  host: string;
  port: number;
  token: string;
  connectMs?: number;
  responseMs?: number;
  readMaxAttempts?: number;
  readBackoffMs?: number;
};

export class TmsClient {
  private readonly host: string;
  private readonly port: number;
  private readonly connectMs: number;
  private readonly responseMs: number;
  private readonly readMaxAttempts: number;
  private readonly readBackoffMs: number;

  constructor(options: TmsClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.connectMs = options.connectMs ?? TMS_CONNECT_MS;
    this.responseMs = options.responseMs ?? TMS_RESPONSE_MS;
    this.readMaxAttempts = options.readMaxAttempts ?? TMS_READ_MAX_ATTEMPTS;
    this.readBackoffMs = options.readBackoffMs ?? TMS_READ_BACKOFF_MS;
  }

  static fromConfig(config: BridgeConfig): TmsClient {
    return new TmsClient({
      host: config.tmsHost,
      port: config.tmsPort,
      token: config.tmsToken,
    });
  }

  /** Single attempt — for LOAD_BOOK (no blind retry). */
  async executeWrite(requestLine: string, label: string): Promise<ParsedTmsResponse> {
    try {
      const lines = await this.requestOnce(requestLine, label);
      return parseTmsResponse(lines);
    } catch (err) {
      if (err instanceof BridgeError) {
        throw err;
      }
      throw toTmsUnavailable(err);
    }
  }

  async executeRead(requestLine: string, label: string): Promise<ParsedTmsResponse> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.readMaxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          await sleep(this.readBackoffMs);
        }
        const lines = await this.requestOnce(requestLine, label);
        return parseTmsResponse(lines);
      } catch (err) {
        lastErr = err;
        if (err instanceof BridgeError) {
          throw err;
        }
      }
    }
    throw toTmsUnavailable(lastErr);
  }

  private async requestOnce(requestLine: string, label: string): Promise<string[]> {
    const t0 = performance.now();
    try {
      return await this.requestOnceSocket(requestLine, label);
    } finally {
      addTmsDuration(Math.round(performance.now() - t0));
    }
  }

  private async requestOnceSocket(requestLine: string, label: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const lines: string[] = [];
      let buffer = "";

      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(responseTimer);
        socket.removeAllListeners();
        socket.destroy();
        action();
      };

      const connectTimer = setTimeout(() => {
        finish(() => reject(new Error(`${label}: connect timeout`)));
      }, this.connectMs);

      const responseTimer = setTimeout(() => {
        finish(() => reject(new Error(`${label}: response timeout`)));
      }, this.responseMs);

      const socket: Socket = createConnection({ host: this.host, port: this.port }, () => {
        clearTimeout(connectTimer);
        socket.write(requestLine);
      });

      socket.setEncoding("ascii");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, "ascii") > TMS_MAX_FRAME_BYTES) {
          finish(() => reject(new Error(`${label}: frame exceeded 4096 bytes`)));
          return;
        }
        let nl: number;
        while ((nl = buffer.indexOf("\r\n")) !== -1) {
          const one = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          lines.push(one);
          if (one === "END" || one.startsWith("ERR|")) {
            finish(() => resolve(lines));
            return;
          }
        }
      });
      socket.on("error", (err) => {
        finish(() => reject(err));
      });
      socket.on("close", () => {
        if (settled) return;
        if (lines.some((l) => l === "END" || l.startsWith("ERR|"))) {
          finish(() => resolve(lines));
          return;
        }
        finish(() => reject(new Error(`${label}: closed before END`)));
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toTmsUnavailable(err: unknown): BridgeError {
  const message =
    err instanceof Error ? err.message : "TMS request failed";
  if (
    message.includes("frame") ||
    message.includes("MALFORMED") ||
    message.includes("PARTIAL") ||
    message.includes("closed before END")
  ) {
    return new BridgeError("TMS_BAD_RESPONSE", message, 502, true);
  }
  if (message.includes("timeout")) {
    return new BridgeError("TMS_UNAVAILABLE", message, 504, true);
  }
  return new BridgeError("TMS_UNAVAILABLE", message, 503, true);
}

export function unwrapTmsResponse(parsed: ParsedTmsResponse): Map<string, string>[] {
  if (parsed.kind === "error") {
    throw bridgeErrorFromTmsWire(parsed.wire.code, parsed.wire.message);
  }
  return parsed.records;
}
