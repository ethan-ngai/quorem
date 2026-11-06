/** @file routes.ts @description Administrator overview transport. @module admin */
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import type { Principal } from "../identity/model.ts";
import { identifyRequest } from "../identity/routes.ts";
import type { AdminOverviewReader } from "./model.ts";

/** @returns Aggregate route; both transport and persistence enforce administrator access. */
export function adminRoutes(deps: {
  identify: (request: Request) => Promise<Principal | undefined>;
  overview: AdminOverviewReader;
}): Hono {
  const app = new Hono();
  app.get("/v1/admin/overview", async (c) => {
    const actor = await identifyRequest(deps.identify, c.req.raw);
    if (!actor) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    if (actor.kind === "guest" || !actor.admin)
      throw new ApplicationError("forbidden", "Administrator access required", 403);
    return c.json(await deps.overview.overview(actor.userId));
  });
  return app;
}
