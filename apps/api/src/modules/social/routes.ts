import { playerSearchMaxLength, playerSearchMaxOffset } from "@quorem/contracts/social-policy";
/** @file routes.ts @description Authenticated social reads with bounded discovery. @module social */
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import type { Principal } from "../identity/model.ts";
import { identifyRequest } from "../identity/routes.ts";
import type { SocialReader } from "./model.ts";
export function socialRoutes(deps: {
  identify: (request: Request) => Promise<Principal | undefined>;
  social: SocialReader;
}) {
  const app = new Hono();
  const actor = async (request: Request) => {
    const who = await identifyRequest(deps.identify, request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    if (who.kind === "guest") throw new ApplicationError("forbidden", "Account required", 403);
    return who.userId;
  };
  app.get("/v1/social", async (c) => c.json(await deps.social.overview(await actor(c.req.raw))));
  app.get("/v1/players", async (c) => {
    const who = await actor(c.req.raw);
    const search = (c.req.query("q") ?? "").trim();
    const rawOffset = c.req.query("offset") ?? "0";
    if (
      search.length > playerSearchMaxLength ||
      !/^\d{1,5}$/.test(rawOffset) ||
      Number(rawOffset) > playerSearchMaxOffset
    )
      throw new ApplicationError("invalid_input", "Invalid player search", 400);
    return c.json(await deps.social.players(who, search, Number(rawOffset)));
  });
  app.get("/v1/players/:id", async (c) => {
    const who = await actor(c.req.raw),
      id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new ApplicationError("invalid_input", "Invalid player ID", 400);
    return c.json(await deps.social.profile(who, id));
  });
  return app;
}
