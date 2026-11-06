/** @file routes.ts @description Read-only completed match review transport. @module matches */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { MatchReview } from "./model.ts";

export function matchReviewRoutes(deps: {
  review: MatchReview;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  app.get("/v1/matches/:id/review", async (c) => {
    const principal = await identifyRequest((request) => deps.identify(request), c.req.raw);
    if (!principal) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    const result = await deps.review.read(principal, c.req.param("id"));
    return c.body(result, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });
  return app;
}
