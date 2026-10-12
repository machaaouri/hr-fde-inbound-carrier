import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestContext } from "./types.ts";

const storage = new AsyncLocalStorage<RequestContext>();

/** Bind per-request context for TMS timing (Node 20+ `enterWith`). */
export function bindRequestContext(ctx: RequestContext): void {
  storage.enterWith(ctx);
}

export function addTmsDuration(ms: number): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.tmsMs = (ctx.tmsMs ?? 0) + ms;
  }
}

export function getBoundRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
