/** @file routes.ts @description Unmounted guest bootstrap and end transport. @module identity */
import { Hono } from "hono";
import { guestSetCookie } from "./cookie.ts";
import { ApplicationError } from "../../../application/error.ts";
import { allowPublicGuestRequest, type GuestRequestBudget } from "../../access/guest.ts";
import { IdentityError, type ManagedPrincipal, type LocalPrincipal } from "../model.ts";
import { bearer } from "../credentials.ts";
import {
  authenticateGuestRequest,
  guestCookie,
  guestOriginAllowed,
  GuestOriginDenied,
  newGuestToken,
  validGuestToken,
  type GuestIdentityReader,
} from "./credentials.ts";

interface Dependencies {
  allowedOrigins: readonly string[];
  admissionEnabled: boolean;
  trustedPeer: () => string | undefined;
  budget: GuestRequestBudget;
  guests: GuestIdentityReader & { endMatch(hash: string): Promise<boolean> };
  managed(token: string): Promise<ManagedPrincipal | LocalPrincipal>;
}
function originAllowed(request: Request, origins: readonly string[]): string {
  const origin = request.headers.get("origin");
  if (!origin || !guestOriginAllowed("POST", origin, origins))
    throw new ApplicationError("forbidden", "Origin denied", 403);
  return origin;
}
async function identity<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof GuestOriginDenied)
      throw new ApplicationError("forbidden", "Origin denied", 403);
    if (error instanceof IdentityError)
      throw new ApplicationError(
        error.kind === "unauthorized" ? "unauthenticated" : "temporarily_unavailable",
        error.kind === "unauthorized" ? "Invalid credentials" : "Identity unavailable",
        error.kind === "unauthorized" ? 401 : 503,
      );
    throw error;
  }
}
export function guestRoutes(deps: Dependencies): Hono {
  const app = new Hono();
  app.post("/v1/guest-sessions", async (c) => {
    if (!(await identity(() => allowPublicGuestRequest(deps.trustedPeer(), deps.budget))))
      throw new ApplicationError(
        "rate_limited",
        "Too many invitation requests; try again shortly",
        429,
      );
    if (!deps.admissionEnabled)
      throw new ApplicationError(
        "temporarily_unavailable",
        "Guest admission is temporarily paused",
        503,
      );
    const origin = originAllowed(c.req.raw, deps.allowedOrigins);
    const credential = await identity(async () => bearer(c.req.raw.headers));
    if (credential !== undefined) await identity(() => deps.managed(credential));
    const existing = await identity(async () => guestCookie(c.req.raw.headers, "match"));
    if (existing !== undefined && validGuestToken(existing)) return c.body(null, 204);
    c.header("Set-Cookie", guestSetCookie("match", newGuestToken(), origin, 86400));
    return c.body(null, 204);
  });
  app.post("/v1/guest-sessions/end", async (c) => {
    const origin = originAllowed(c.req.raw, deps.allowedOrigins);
    const principal = await identity(() =>
      authenticateGuestRequest(
        c.req.raw.headers,
        "match",
        (token) => deps.managed(token),
        deps.guests,
        { method: c.req.method, allowedOrigins: deps.allowedOrigins },
      ),
    );
    if (!principal || principal.kind !== "guest" || principal.scope.kind !== "match")
      throw new ApplicationError("forbidden", "Guest session required", 403);
    if (!(await deps.guests.endMatch(principal.sessionId))) {
      const current = await identity(() => deps.guests.lookup("match", principal.sessionId));
      if (!current) throw new ApplicationError("unauthenticated", "Guest session expired", 401);
      throw new ApplicationError("invalid_transition", "The guest match is still active", 409);
    }
    c.header("Set-Cookie", guestSetCookie("match", "", origin, 0));
    return c.body(null, 204);
  });
  return app;
}
