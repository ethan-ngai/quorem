/** @file routes.ts @description Persistent party HTTP transport. @module parties */
import { allowPublicGuestRequest, type GuestRequestBudget } from "../access/guest.ts";
import { guestCookie, guestOriginAllowed } from "../identity/guest/credentials.ts";
import { bearer } from "../identity/credentials.ts";
import { IdentityError } from "../identity/model.ts";
import { jsonObjectBody } from "../../application/json-body.ts";
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import { identifyRequest } from "../identity/routes.ts";
import type { Principal } from "../identity/model.ts";
import { normalizePartySettings, type Parties } from "./model.ts";

export function partyRoutes(deps: {
  parties: Parties;
  identify(request: Request): Promise<Principal | undefined>;
  allowedOrigins: readonly string[];
  admissionEnabled: boolean;
  trustedPeer(): string | undefined;
  budget: GuestRequestBudget;
}) {
  const app = new Hono();
  const actor = async (request: Request) => {
    const who = await identifyRequest((incoming) => deps.identify(incoming), request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    return who;
  };
  const key = (request: Request) => {
    const k = request.headers.get("Idempotency-Key");
    if (!k || new TextEncoder().encode(k).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    return k;
  };
  app.get("/v1/parties/current", async (c) =>
    c.json(await deps.parties.current(await actor(c.req.raw))),
  );
  app.post("/v1/parties", async (c) =>
    c.json(
      await deps.parties.create(
        await actor(c.req.raw),
        key(c.req.raw),
        normalizePartySettings(await jsonObjectBody(c.req.raw, 4096, { emptyObject: true })),
      ),
      201,
    ),
  );
  const budget = async () => {
    try {
      if (!(await allowPublicGuestRequest(deps.trustedPeer(), deps.budget)))
        throw new ApplicationError(
          "rate_limited",
          "Too many invitation requests; try again shortly",
          429,
        );
    } catch (error) {
      if (error instanceof IdentityError)
        throw new ApplicationError("temporarily_unavailable", "Service unavailable", 503);
      throw error;
    }
  };
  app.get("/v1/parties/invitations/:token", async (c) => {
    await budget();
    c.header("Referrer-Policy", "no-referrer");
    return c.json(await deps.parties.preview(c.req.param("token")));
  });
  app.post("/v1/parties/invitations/:token/guest", async (c) => {
    await budget();
    if (!deps.admissionEnabled)
      throw new ApplicationError(
        "temporarily_unavailable",
        "Guest admission is temporarily paused",
        503,
      );
    const origin = c.req.raw.headers.get("origin");
    if (!origin || !guestOriginAllowed("POST", origin, deps.allowedOrigins))
      throw new ApplicationError("forbidden", "Origin denied", 403);
    let credential: string | undefined, authorization: string | undefined;
    try {
      credential = guestCookie(c.req.raw.headers, "match");
      authorization = bearer(c.req.raw.headers);
    } catch (error) {
      if (error instanceof IdentityError)
        throw new ApplicationError("unauthenticated", "Invalid credentials", 401);
      throw error;
    }
    if (authorization !== undefined || c.req.raw.headers.has("x-dev-user")) {
      const who = await actor(c.req.raw);
      if (who.kind !== "guest")
        throw new ApplicationError("forbidden", "Use your account to join", 403);
    }
    if (!credential)
      throw new ApplicationError("unauthenticated", "Start a guest session first", 401);
    const input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
    if (Object.keys(input).some((x) => x !== "name") || typeof input.name !== "string")
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    c.header("Referrer-Policy", "no-referrer");
    return c.json(await deps.parties.joinGuest(c.req.param("token"), credential, input.name));
  });
  app.post("/v1/parties/join", async (c) => {
    const who = await actor(c.req.raw),
      k = key(c.req.raw),
      input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
    if (Object.keys(input).some((x) => x !== "token") || typeof input.token !== "string")
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    return c.json(await deps.parties.join(who, k, input.token));
  });
  app.get("/v1/parties/:id", async (c) =>
    c.json(await deps.parties.read(await actor(c.req.raw), c.req.param("id"))),
  );
  app.put("/v1/parties/:id/settings", async (c) =>
    c.json(
      await deps.parties.mutate(
        await actor(c.req.raw),
        c.req.param("id"),
        key(c.req.raw),
        "settings",
        normalizePartySettings(await jsonObjectBody(c.req.raw, 4096, { emptyObject: true })),
      ),
    ),
  );
  app.post("/v1/parties/:id/ready", async (c) => {
    const who = await actor(c.req.raw),
      k = key(c.req.raw),
      input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
    if (Object.keys(input).some((x) => x !== "ready") || typeof input.ready !== "boolean")
      throw new ApplicationError("invalid_input", "Ready is required", 400);
    return c.json(await deps.parties.mutate(who, c.req.param("id"), k, "ready", input.ready));
  });
  app.post("/v1/parties/:id/kick", async (c) => {
    const who = await actor(c.req.raw),
      k = key(c.req.raw),
      input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
    if (
      Object.keys(input).some((key) => key !== "userId") ||
      typeof input.userId !== "string" ||
      !input.userId ||
      input.userId.length > 128
    )
      throw new ApplicationError("invalid_input", "User is required", 400);
    return c.json(await deps.parties.mutate(who, c.req.param("id"), k, "kick", input.userId));
  });
  for (const action of ["leave", "disband"] as const)
    app.post(`/v1/parties/:id/${action}`, async (c) => {
      const who = await actor(c.req.raw),
        k = key(c.req.raw),
        input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
      if (Object.keys(input).length)
        throw new ApplicationError("invalid_input", "Invalid request body", 400);
      return c.json(await deps.parties.mutate(who, c.req.param("id"), k, action, null));
    });
  app.post("/v1/presence/heartbeat", async (c) => {
    const who = await actor(c.req.raw),
      input = await jsonObjectBody(c.req.raw, 4096, { emptyObject: true });
    if (Object.keys(input).some((x) => x !== "windowId") || typeof input.windowId !== "string")
      throw new ApplicationError("invalid_input", "Invalid window", 400);
    return c.json(await deps.parties.heartbeat(who, input.windowId));
  });
  return app;
}
