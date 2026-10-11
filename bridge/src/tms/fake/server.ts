import { createServer, type Socket } from "node:net";
import { TMS_FIELD } from "../fields.ts";
import type { FakeLoadRecord } from "./fixtures.ts";
import {
  defaultFakeLoads,
  toFullLine,
  toQueryLine,
} from "./fixtures.ts";
import { parseTmsRequestLine } from "./parse-request.ts";

export type FakeTmsFault =
  | "timeout"
  | "partial"
  | "malformed"
  | "delayed_close";

export type FakeTmsServerOptions = {
  token?: string;
  loads?: FakeLoadRecord[];
};

export class FakeTmsServer {
  private readonly token: string;
  private loads: FakeLoadRecord[];
  private fault: FakeTmsFault | null = null;

  constructor(options: FakeTmsServerOptions = {}) {
    this.token = options.token ?? "t-test-fake";
    this.loads = options.loads ?? defaultFakeLoads();
  }

  setFault(fault: FakeTmsFault | null): void {
    this.fault = fault;
  }

  async listen(port = 0): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        let buffer = "";
        socket.setEncoding("ascii");
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          const nl = buffer.indexOf("\r\n");
          if (nl === -1) {
            return;
          }
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          void this.handleRequest(socket, line);
        });
      });

      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("fake TMS listen failed"));
          return;
        }
        resolve({
          port: addr.port,
          close: () =>
            new Promise((res, rej) => {
              server.close((err) => (err ? rej(err) : res()));
            }),
        });
      });
    });
  }

  private async handleRequest(socket: Socket, line: string): Promise<void> {
    let req;
    try {
      req = parseTmsRequestLine(line);
    } catch {
      socket.write("ERR|CODE:MALFORMED|MSG:invalid request line\r\n");
      socket.end();
      return;
    }

    if (req.cmd === "DEBUG_ECHO") {
      if (req.auth !== this.token) {
        socket.write(
          "ERR|CODE:AUTH_FAILED|MSG:invalid or missing auth token\r\n",
        );
        socket.end();
        return;
      }
      const msg = req.fields.get(TMS_FIELD.MSG) ?? "";
      const fieldsParsed = 2 + req.fields.size;
      socket.write(
        `ECHO|AUTH:OK|FIELDS_PARSED:${fieldsParsed}|MSG:${msg}\r\nEND\r\n`,
      );
      socket.end();
      return;
    }

    if (req.auth !== this.token) {
      socket.write(
        "ERR|CODE:AUTH_FAILED|MSG:invalid or missing auth token\r\n",
      );
      socket.end();
      return;
    }

    const fault = this.fault;
    if (fault === "timeout") {
      return;
    }

    if (fault === "partial") {
      const sample = this.loads[0];
      if (sample) {
        socket.write(`${toQueryLine(sample)}\r\n`);
      }
      socket.end();
      return;
    }

    if (fault === "malformed") {
      socket.write("LOAD_ID:LD-BAD|ORIG_CITY:Bad|\r\n");
      socket.end();
      return;
    }

    let body: string;
    switch (req.cmd) {
      case "LOAD_QUERY":
        body = this.handleLoadQuery(req.fields);
        break;
      case "LOAD_GET":
        body = this.handleLoadGet(req.fields);
        break;
      case "LOAD_BOOK":
        body = "ERR|CODE:SERVER_ERROR|MSG:LOAD_BOOK not implemented on fake TMS\r\n";
        break;
      default:
        body = "ERR|CODE:UNKNOWN_CMD|MSG:unknown command\r\n";
        break;
    }

    if (body.startsWith("ERR|")) {
      socket.write(`${body}\r\n`);
      socket.end();
      return;
    }

    socket.write(body);
    if (fault !== "delayed_close") {
      socket.end();
    }
  }

  private handleLoadQuery(fields: Map<string, string>): string {
    if (fields.size === 0) {
      return "ERR|CODE:MISSING_FIELD|MSG:at least one filter required";
    }

    const origState = fields.get(TMS_FIELD.ORIG_STATE)?.trim();
    const destState = fields.get(TMS_FIELD.DEST_STATE)?.trim();
    const origCity = fields.get(TMS_FIELD.ORIG_CITY)?.trim().toLowerCase();
    const eqtype = fields.get(TMS_FIELD.EQTYPE)?.trim();
    const maxResults = Number.parseInt(
      fields.get(TMS_FIELD.MAX_RESULTS)?.trim() ?? "50",
      10,
    );

    const matches = this.loads.filter((record) => {
      if (eqtype && record.get(TMS_FIELD.EQTYPE)?.trim() !== eqtype) {
        return false;
      }
      if (origState && record.get(TMS_FIELD.ORIG_STATE)?.trim() !== origState) {
        return false;
      }
      if (destState && record.get(TMS_FIELD.DEST_STATE)?.trim() !== destState) {
        return false;
      }
      if (origCity) {
        const city = record.get(TMS_FIELD.ORIG_CITY)?.trim().toLowerCase() ?? "";
        if (!city.includes(origCity)) {
          return false;
        }
      }
      return true;
    });

    const lines = matches.slice(0, maxResults).map((r) => toQueryLine(r));
    return lines.length === 0 ? "END\r\n" : `${lines.join("\r\n")}\r\nEND\r\n`;
  }

  private handleLoadGet(fields: Map<string, string>): string {
    const loadId = fields.get(TMS_FIELD.LOAD_ID)?.trim();
    if (!loadId) {
      return "ERR|CODE:MISSING_FIELD|MSG:LOAD_ID required";
    }
    const record = this.loads.find(
      (r) => r.get(TMS_FIELD.LOAD_ID)?.trim() === loadId,
    );
    if (!record) {
      return "ERR|CODE:UNKNOWN_LOAD|MSG:load not found";
    }
    return `${toFullLine(record)}\r\nEND\r\n`;
  }
}
