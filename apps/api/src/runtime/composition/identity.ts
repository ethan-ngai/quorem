/** @file identity.ts @description Live managed and guest identity composition. @module runtime */
import type { ConnectionScope } from "@quorem/database/core";
import { sudoExpiresAt } from "@quorem/contracts/auth-policy";
import {
  bindAccount,
  IdentityError,
  type AccountIdentity,
  type IdentityBindings,
  type Principal,
} from "../../modules/identity/model.ts";
import {
  authenticateGuestRequest,
  guestOriginAllowed,
  GuestOriginDenied,
  type GuestKind,
} from "../../modules/identity/guest/credentials.ts";
import { managedGrant } from "../../modules/identity/grant.ts";
import { identityRepository } from "../../adapters/postgres/identity/repository.ts";
import { guestRepository } from "../../adapters/postgres/identity/guest.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type CookieSession = {
  present(request: Request): boolean;
  read(
    headers: Headers,
    refresh: boolean,
  ): Promise<(AccountIdentity & { strongAt?: number; setCookies: string[] }) | undefined>;
};
/** Remote session verification completes before acquiring an identity database scope. */
export function composeIdentity(
  run: Run,
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
  const renewals = new WeakMap<Request, string[]>();
  const account = async (request: Request, refresh: boolean) => {
    if (!cookieSession.present(request)) return;
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      !guestOriginAllowed(request.method, request.headers.get("origin"), origins)
    )
      throw new GuestOriginDenied();
    try {
      return await cookieSession.read(request.headers, refresh);
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError("unavailable", error);
    }
  };
  const socketSession = async (request: Request) => {
    if (request.headers.has("authorization")) throw new IdentityError("unauthorized");
    const current = await account(request, false);
    if (current)
      return managedGrant(current, sudoExpiresAt(current.strongAt, Math.floor(Date.now() / 1000)));
  };
  const identifyAccount = async (request: Request) => {
    if (request.headers.has("authorization")) throw new IdentityError("unauthorized");
    const current = await account(request, new URL(request.url).pathname === "/v1/session");
    if (current) {
      if (current.setCookies.length) renewals.set(request, current.setCookies);
      return bindAccount(current, bindings, current.strongAt);
    }
  };
  const identify = async (request: Request): Promise<Principal | undefined> => {
    const current = await identifyAccount(request);
    if (current) return current;
    const path = new URL(request.url).pathname;
    const first: GuestKind = path.startsWith("/v1/interview") ? "interview" : "match";
    const policy = { method: request.method, allowedOrigins: origins };
    const check = (kind: GuestKind) =>
      authenticateGuestRequest(request.headers, kind, guests, policy);
    const principal = await check(first);
    if (!path.startsWith("/v1/submissions/")) return principal ?? undefined;
    const other = await check(first === "match" ? "interview" : "match");
    if (principal && other) throw new IdentityError("unauthorized");
    return principal ?? other ?? undefined;
  };
  return {
    identify,
    identifyAccount,
    guests,
    socketSession,
    renewedCookies: (request: Request) => renewals.get(request) ?? [],
  };
}
