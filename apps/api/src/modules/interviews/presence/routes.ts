/** @file routes.ts @description Advisory presence HTTP transport. @module interviews */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { InterviewPresence, PresenceInput } from "./model.ts";
import { advisoryBody } from "./request.ts";
export function interviewPresenceRoutes(deps: {
  presence: InterviewPresence;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  const who = async (r: Request) => {
    const actor = await identifyRequest((x) => deps.identify(x), r);
    if (!actor)
      throw new ApplicationError("unauthenticated", "Sign in or join this interview", 401);
    return actor;
  };
  app.get("/v1/interviews/:id/presence", async (c) =>
    c.json(await deps.presence.peers(await who(c.req.raw), c.req.param("id"))),
  );
  app.post("/v1/interviews/:id/presence", async (c) => {
    const actor = await who(c.req.raw),
      value = await advisoryBody(c.req.raw);
    if (
      Object.keys(value).some(
        (k) => !["clientID", "epoch", "version", "anchor", "head"].includes(k),
      )
    )
      throw new ApplicationError("invalid_input", "Invalid editor presence", 400);
    return c.json(await deps.presence.update(actor, c.req.param("id"), value as PresenceInput));
  });
  return app;
}
