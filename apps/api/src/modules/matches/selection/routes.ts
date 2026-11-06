/** @file routes.ts @description Active match workspace-language transport. @module matches */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { MatchLanguageSelection } from "./model.ts";
async function body(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new ApplicationError("payload_too_large", "Invalid request body", 413);
  const reader = request.body?.getReader(),
    decoder = new TextDecoder();
  let text = "",
    size = 0;
  if (reader)
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApplicationError("payload_too_large", "Invalid request body", 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
  text += decoder.decode();
  try {
    const value: unknown = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  }
}
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
      input = await body(c.req.raw, 4096);
    if (Object.keys(input).some((k) => k !== "language") || typeof input.language !== "string")
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    return c.json(
      await deps.language.switchLanguage(who, c.req.param("id"), operation, input.language),
    );
  });
  return app;
}
