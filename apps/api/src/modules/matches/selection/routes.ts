/** @file routes.ts @description Active match workspace-language transport. @module matches */
import { jsonObjectBody } from "../../../application/json-body.ts";
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { MatchLanguageSelection } from "./model.ts";

export function matchLanguageRoutes(deps: {
  language: MatchLanguageSelection;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  const actor = async (request: Request) => {
    const who = await identifyRequest((incoming) => deps.identify(incoming), request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    return who;
  };
  const key = (request: Request) => {
    const value = request.headers.get("Idempotency-Key");
    if (!value || new TextEncoder().encode(value).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    return value;
  };
  app.post("/v1/matches/:id/workspace-language", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
    if (Object.keys(input).some((k) => k !== "language") || typeof input.language !== "string")
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    return c.json(
      await deps.language.switchLanguage(who, c.req.param("id"), operation, input.language),
    );
  });
  return app;
}
