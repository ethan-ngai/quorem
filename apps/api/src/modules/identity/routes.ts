import { Hono } from "hono";
import type { CapabilityReader, Capabilities } from "../access/model.ts";
import type { GuestIdentityReader } from "./guest/credentials.ts";
import { readMatchGuestSession } from "./guest/session.ts";
import { guestSetCookie } from "./guest/cookie.ts";
/** @file routes.ts @description Identity session transport and shared error mapping. @module identity */
import { ApplicationError } from "../../application/error.ts";
import { IdentityError, type Principal } from "./model.ts";
import { GuestOriginDenied } from "./guest/credentials.ts";
/** Resolve identity and translate expected authority failures for the shared HTTP handler. */
export async function identifyRequest(
  identify: (request: Request) => Promise<Principal | undefined>,
  request: Request,
): Promise<Principal | undefined> {
  try {
    return await identify(request);
  } catch (error) {
    throw mapIdentityError(error);
  }
}
/** Translate identity failures at transport boundaries without exposing their causes. */
export function mapIdentityError(error: unknown): unknown {
  let mapped: ApplicationError | undefined;
  if (error instanceof GuestOriginDenied)
    mapped = new ApplicationError("forbidden", "Origin denied", 403);
  else if (error instanceof IdentityError)
    mapped =
      error.kind === "unauthorized"
        ? new ApplicationError("unauthenticated", "Invalid credentials", 401)
        : new ApplicationError("temporarily_unavailable", "Service unavailable", 503);
  if (!mapped) return error;
  Object.defineProperty(mapped, "cause", { value: error });
  return mapped;
}

export function identityRoutes(deps: {
  identify: (request: Request) => Promise<Principal | undefined>;
  capabilities: CapabilityReader;
  guests: GuestIdentityReader & { endMatch(hash: string): Promise<boolean> };
}): Hono {
  const app = new Hono();
  const principal = async (request: Request) => {
    const value = await identifyRequest(deps.identify, request);
    if (!value) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    return value;
  };
  app.get("/v1/capabilities", async (c) => {
    const value = await principal(c.req.raw);
    if (value.kind === "guest")
      throw new ApplicationError("forbidden", "An account is required", 403);
    return c.json(await deps.capabilities.capabilities(value.userId));
  });
  app.get("/v1/session", async (c) => {
    let value = await principal(c.req.raw);
    let capabilities: Capabilities;
    if (value.kind === "guest") {
      let session;
      try {
        session = await readMatchGuestSession(value, deps.guests);
      } catch (error) {
        throw mapIdentityError(error);
      }
      if (session.kind === "ended") {
        c.header("Set-Cookie", guestSetCookie("match", "", c.req.url, 0));
        throw new ApplicationError("unauthenticated", "Guest session ended", 401);
      }
      value = session.principal;
      capabilities = {
        authorCustomQuestions: false,
        interviewConcurrency: 0,
        hostGuests: false,
        hostedIntelligence: false,
        experimental: false,
        interviews: false,
        guestConcurrency: 0,
      };
    } else capabilities = await deps.capabilities.capabilities(value.userId);
    return c.json({
      capabilities,
      strongUntil: value.strongUntil,
      kind: value.kind === "guest" ? "guest" : "account",
      matchId: value.kind === "guest" && value.scope.kind === "match" ? value.scope.matchId : "",
      user: {
        id: value.userId,
        displayName: value.displayName,
        emailVerified: value.emailVerified,
        role: value.admin ? "admin" : "user",
      },
      mode: value.kind === "local" ? "development" : "managed",
    });
  });
  return app;
}
