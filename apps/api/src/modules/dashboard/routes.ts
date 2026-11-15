/** @file routes.ts @description Account-scoped dashboard and streak transport. */
import type { PlayerDashboard } from "@quorem/contracts";
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import type { Principal } from "../identity/model.ts";
import { identifyRequest } from "../identity/routes.ts";

export function dashboardRoutes(deps: {
  identify: (request: Request) => Promise<Principal | undefined>;
  read: (owner: string, timeZone: string) => Promise<PlayerDashboard>;
}) {
  const app = new Hono();
  app.get("/v1/me/dashboard", async (c) => {
    const actor = await identifyRequest(deps.identify, c.req.raw);
    if (!actor) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    if (actor.kind === "guest") throw new ApplicationError("forbidden", "Account required", 403);
    const requested = c.req.query("timeZone") ?? "UTC";
    let timeZone: string;
    try {
      if (!/^[A-Za-z0-9_+\-/]{1,80}$/.test(requested)) throw new RangeError();
      timeZone = new Intl.DateTimeFormat("en", { timeZone: requested }).resolvedOptions().timeZone;
    } catch {
      throw new ApplicationError("invalid_input", "Invalid timezone", 400);
    }
    c.header("Cache-Control", "private, no-store");
    return c.json(await deps.read(actor.userId, timeZone));
  });
  return app;
}
