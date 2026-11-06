/** @file routes.ts @description Read-only completed match review transport. @module matches */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import { body, languages } from "../../workspace/routes.ts";
import type { WorkspaceLanguage } from "../../workspace/model.ts";
import type { MatchReview } from "./model.ts";

export function matchReviewRoutes(deps: {
  review: MatchReview;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  app.post("/v1/matches/:id/review/workspaces", async (c) => {
    const principal = await identifyRequest((request) => deps.identify(request), c.req.raw);
    if (!principal) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    const value = await body(c.req.raw);
    if (
      Object.keys(value).some((key) => key !== "participantUserId" && key !== "language") ||
      typeof value.participantUserId !== "string" ||
      typeof value.language !== "string" ||
      !languages.includes(value.language)
    )
      throw new ApplicationError("invalid_input", "Invalid review workspace", 400);
    return c.json(
      await deps.review.createWorkspace(
        principal,
        c.req.param("id"),
        value.participantUserId,
        value.language as WorkspaceLanguage,
      ),
      201,
    );
  });
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
