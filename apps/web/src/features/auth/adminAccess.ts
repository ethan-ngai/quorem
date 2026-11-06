/** @file adminAccess.ts @description Shared admin and authoring route admission. @module auth */
import { notFound, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { sessionQueryOptions, type Session } from "./session";

type Access = "admin" | "authoring";
export function canAccess(session: Session | null | undefined, access: Access) {
  return (
    !!session &&
    session.kind !== "guest" &&
    (session.user.role === "admin" ||
      (access === "authoring" && !!session.capabilities?.authorCustomQuestions))
  );
}
export function requireAdminSession(
  session: Session | null,
  href: string,
  access: Access = "admin",
) {
  if (!session || session.kind === "guest")
    throw redirect({ href: `/login?${new URLSearchParams({ returnTo: href })}`, replace: true });
  if (!canAccess(session, access)) throw notFound();
}

/** Recheck permissions at navigation; cached display hints cannot admit a revoked account. */
async function requireAccess(cache: QueryClient, href: string, access: Access) {
  const session = await cache.fetchQuery({ ...sessionQueryOptions(), staleTime: 0 });
  requireAdminSession(session, href, access);
}
export const requireAdminAccess = (cache: QueryClient, href: string) =>
  requireAccess(cache, href, "admin");
export const requireAuthoringAccess = (cache: QueryClient, href: string) =>
  requireAccess(cache, href, "authoring");
