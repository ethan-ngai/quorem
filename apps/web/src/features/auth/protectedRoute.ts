/** @file protectedRoute.ts @description Shared admission and sign-in destinations for protected routes. @module auth */
import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { sessionQueryOptions, type Session } from "./session";

export function signInRedirectOptions(returnTo: string) {
  return { href: `/login?${new URLSearchParams({ returnTo })}`, replace: true };
}

export function hasRouteSession(session: Session | null | undefined, allowGuest = false) {
  return !!session && (allowGuest || session.kind !== "guest");
}

/** Recheck admission at navigation, even when display hints are cached. */
export function readRouteSession(cache: QueryClient) {
  return cache.fetchQuery({ ...sessionQueryOptions(), staleTime: 0 });
}

export async function requireRouteSession(cache: QueryClient, href: string, allowGuest = false) {
  const session = await readRouteSession(cache);
  if (!hasRouteSession(session, allowGuest)) throw redirect(signInRedirectOptions(href));
}

export function isRouteDenied(status: number | undefined) {
  return status === 403 || status === 404;
}
