import type { RequestContext } from "../http/types.ts";

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}
