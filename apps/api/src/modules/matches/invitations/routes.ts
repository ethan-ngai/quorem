/** @file routes.ts @description Unmounted invitation and match selection transport. @module matches */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import { allowPublicGuestRequest, type GuestRequestBudget } from "../../access/guest.ts";
import { bearer } from "../../identity/credentials.ts";
import { guestCookie, guestOriginAllowed } from "../../identity/guest/credentials.ts";
import { IdentityError, type Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { MatchLanguageSelection } from "../selection/model.ts";
import type { MatchInvitations } from "./model.ts";
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
export function matchInvitationRoutes(deps: {
  invitations: MatchInvitations;
  language: MatchLanguageSelection;
  identify(request: Request): Promise<Principal | undefined>;
  allowedOrigins: readonly string[];
  admissionEnabled: boolean;
  trustedPeer(): string | undefined;
  budget: GuestRequestBudget;
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
  app.get("/v1/match-invites/:token", async (c) => {
    await budget();
    c.header("Referrer-Policy", "no-referrer");
    return c.json(await deps.invitations.preview(c.req.param("token")));
  });
  app.post("/v1/matches/join", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      input = await body(c.req.raw, 4096);
    if (
      Object.keys(input).some((k) => k !== "inviteToken") ||
      typeof input.inviteToken !== "string"
    )
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    return c.json(await deps.invitations.join(who, operation, input.inviteToken));
  });
  app.post("/v1/match-invites/:token/guest", async (c) => {
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
    let authorization: string | undefined, credential: string | undefined;
    try {
      authorization = bearer(c.req.raw.headers);
      credential = guestCookie(c.req.raw.headers, "match");
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
    const input = await body(c.req.raw, 512);
    if (Object.keys(input).some((k) => k !== "name") || typeof input.name !== "string")
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    c.header("Referrer-Policy", "no-referrer");
    return c.json(await deps.invitations.joinGuest(c.req.param("token"), credential, input.name));
  });
  app.post("/v1/matches/:id/rotate-invite", async (c) =>
    c.json(
      await deps.invitations.rotate(await actor(c.req.raw), c.req.param("id"), key(c.req.raw)),
    ),
  );
  app.post("/v1/matches/:id/guests/:guest/remove", async (c) =>
    c.json(
      await deps.invitations.removeGuest(
        await actor(c.req.raw),
        c.req.param("id"),
        c.req.param("guest"),
        key(c.req.raw),
      ),
    ),
  );
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
