/** @file routes.ts @description Unmounted match lifecycle transport. @module matches */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import { identifyRequest } from "../../identity/routes.ts";
import { guestSetCookie } from "../../identity/guest/cookie.ts";
import type { Principal } from "../../identity/model.ts";
import { normalizeSettings, type Lifecycle } from "./model.ts";
async function body(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new ApplicationError("payload_too_large", "Invalid request body", 413);
  const reader = request.body?.getReader(),
    decoder = new TextDecoder();
  let text = "",
    size = 0;
  if (reader)
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApplicationError("payload_too_large", "Invalid request body", 413);
      }
      text += decoder.decode(p.value, { stream: true });
    }
  text += decoder.decode();
  try {
    const result: unknown = JSON.parse(text || "{}");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch {
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  }
}
export function matchLifecycleRoutes(deps: {
  lifecycle: Lifecycle;
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
  app.post("/v1/matches", async (c) =>
    c.json(
      await deps.lifecycle.create(
        await actor(c.req.raw),
        key(c.req.raw),
        normalizeSettings(await body(c.req.raw, 4096)),
      ),
      201,
    ),
  );
  app.get("/v1/matches/current", async (c) =>
    c.json(await deps.lifecycle.current(await actor(c.req.raw))),
  );
  app.get("/v1/matches/:id", async (c) =>
    c.json(await deps.lifecycle.read(await actor(c.req.raw), c.req.param("id"))),
  );
  app.put("/v1/matches/:id/settings", async (c) =>
    c.json(
      await deps.lifecycle.mutate(
        await actor(c.req.raw),
        c.req.param("id"),
        key(c.req.raw),
        "settings",
        normalizeSettings(await body(c.req.raw, 4096)),
      ),
    ),
  );
  app.post("/v1/matches/:id/ready", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      input = await body(c.req.raw, 1024);
    if (Object.keys(input).some((k) => k !== "ready") || typeof input.ready !== "boolean")
      throw new ApplicationError("invalid_input", "Ready is required", 400);
    return c.json(
      await deps.lifecycle.mutate(who, c.req.param("id"), operation, "ready", input.ready),
    );
  });
  for (const action of ["start", "leave", "forfeit"] as const)
    app.post(`/v1/matches/:id/${action}`, async (c) => {
      const who = await actor(c.req.raw),
        operation = key(c.req.raw),
        input = await body(c.req.raw, 1024);
      if (Object.keys(input).length)
        throw new ApplicationError("invalid_input", "Invalid request body", 400);
      const result = await deps.lifecycle.mutate(who, c.req.param("id"), operation, action, null);
      if (
        action === "leave" &&
        who.kind === "guest" &&
        !(result as { startedAt?: unknown }).startedAt
      ) {
        const origin = c.req.raw.headers.get("origin") ?? new URL(c.req.raw.url).origin;
        c.header("Set-Cookie", guestSetCookie("match", "", origin, 0));
      }
      return c.json(result);
    });
  return app;
}
