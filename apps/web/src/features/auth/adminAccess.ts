/** @file adminAccess.ts @description Shared admin and authoring route admission. @module auth */
import { notFound, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { hasRouteSession, readRouteSession, signInRedirectOptions } from "./protectedRoute";
import type { Session } from "./session";

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
  if (!hasRouteSession(session)) throw redirect(signInRedirectOptions(href));
  if (!canAccess(session, access)) throw notFound();
}

async function requireAccess(cache: QueryClient, href: string, access: Access) {
  const session = await readRouteSession(cache);
  requireAdminSession(session, href, access);
}
export const requireAdminAccess = (cache: QueryClient, href: string) =>
  requireAccess(cache, href, "admin");
export const requireAuthoringAccess = (cache: QueryClient, href: string) =>
  requireAccess(cache, href, "authoring");
