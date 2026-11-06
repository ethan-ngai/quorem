/** @file routes.ts @description Authenticated team lobby, document and voting transport. @module factions */
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import { jsonObjectBody } from "../../application/json-body.ts";
import { identifyRequest } from "../identity/routes.ts";
import type { Principal } from "../identity/model.ts";
import type { Factions } from "./model.ts";
export function factionRoutes(deps: {
  factions: Factions;
  identify(request: Request): Promise<Principal | undefined>;
}) {
  const app = new Hono();
  const actor = async (request: Request) => {
    const who = await identifyRequest((incoming) => deps.identify(incoming), request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    return who;
  };
  const key = (request: Request) => {
    const value = request.headers.get("Idempotency-Key") ?? "";
    if (!value || new TextEncoder().encode(value).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    return value;
  };
  app.get("/v1/parties/:id/teams", async (c) =>
    c.json(await deps.factions.lobby(await actor(c.req.raw), c.req.param("id"))),
  );
  app.post("/v1/parties/:id/teams", async (c) => {
    const who = await actor(c.req.raw);
    return c.json(
      await deps.factions.organize(
        who,
        c.req.param("id"),
        key(c.req.raw),
        await jsonObjectBody(c.req.raw, 4096),
      ),
    );
  });
  app.get("/v1/matches/:id/team", async (c) =>
    c.json(await deps.factions.read(await actor(c.req.raw), c.req.param("id"))),
  );
  for (const action of ["pull", "push", "presence", "propose", "vote", "cancel"])
    app.post(`/v1/matches/:id/team/${action}`, async (c) => {
      const who = await actor(c.req.raw);
      return c.json(
        await deps.factions.command(
          who,
          c.req.param("id"),
          key(c.req.raw),
          action,
          await jsonObjectBody(c.req.raw, 256 * 1024),
        ),
      );
    });
  return app;
}
