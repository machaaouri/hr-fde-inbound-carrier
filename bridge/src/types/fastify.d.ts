import type { RequestContext } from "../http/errors.ts";

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}
