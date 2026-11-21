/** @file identity.ts @description Live managed and guest identity composition. @module runtime */
import type { ConnectionScope } from "@quorem/database/core";
import {
  authenticate,
  authenticateAccount,
  IdentityError,
  type AccountIdentity,
  type IdentityBindings,
  type Principal,
  type SessionAuthority,
  type TokenVerifier,
} from "../../modules/identity/model.ts";
import {
  authenticateGuestRequest,
  guestOriginAllowed,
  GuestOriginDenied,
  type GuestKind,
} from "../../modules/identity/guest/credentials.ts";
import { bearer } from "../../modules/identity/credentials.ts";
import { identityRepository } from "../../adapters/postgres/identity/repository.ts";
import { guestRepository } from "../../adapters/postgres/identity/guest.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type CookieSession = {
  present(request: Request): boolean;
  read(headers: Headers): Promise<AccountIdentity | undefined>;
};
/** Remote session verification completes before acquiring an identity database scope. */
export function composeIdentity(
  run: Run,
  verifier: TokenVerifier,
  sessions: SessionAuthority,
  origins: readonly string[],
  cookieSession: CookieSession,
) {
  const bindings: IdentityBindings = {
    lookup: (claims) => run((scope) => identityRepository(scope).lookup(claims)),
    resolve: (claims) => run((scope) => identityRepository(scope).resolve(claims)),
  };
  const guests = {
    lookup: (kind: GuestKind, hash: string) =>
      run((scope) => guestRepository(scope).lookup(kind, hash)),
    canBootstrap: (hash: string) => run((scope) => guestRepository(scope).canBootstrap(hash)),
    endMatch: (hash: string) => run((scope) => guestRepository(scope).endMatch(hash)),
  };
  const managed = (token: string, signal?: AbortSignal) =>
    authenticate(token, verifier, sessions, bindings, signal);
  const accountCookie = async (request: Request) => {
    if (!cookieSession.present(request)) return;
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      !guestOriginAllowed(request.method, request.headers.get("origin"), origins)
    )
      throw new GuestOriginDenied();
    try {
      const claims = await cookieSession.read(request.headers);
      if (claims) return await authenticateAccount(claims, sessions, bindings, request.signal);
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError("unavailable", error);
    }
  };
  const identify = async (request: Request): Promise<Principal | undefined> => {
    const token = bearer(request.headers);
    if (token !== undefined) return managed(token, request.signal);
    const account = await accountCookie(request);
    if (account) return account;
    const path = new URL(request.url).pathname;
    const first: GuestKind = path.startsWith("/v1/interview") ? "interview" : "match";
    const policy = { method: request.method, allowedOrigins: origins };
    const check = (kind: GuestKind) =>
      authenticateGuestRequest(
        request.headers,
        kind,
        (token) => managed(token, request.signal),
        guests,
        policy,
      );
    const principal = await check(first);
    if (principal?.kind !== "guest" && principal) return principal;
    if (!path.startsWith("/v1/submissions/")) return principal ?? undefined;
    const other = await check(first === "match" ? "interview" : "match");
    if (principal && other) throw new IdentityError("unauthorized");
    return principal ?? other ?? undefined;
  };
  return { identify, managed, guests, accountCookie };
}
