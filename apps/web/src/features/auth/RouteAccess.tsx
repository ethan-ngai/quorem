/** @file RouteAccess.tsx @description Keeps protected pages gated after session changes. @module auth */
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { RouteError } from "../../ui/RouteError";
import { NotFoundPage } from "../public/NotFoundPage";
import { canAccess } from "./adminAccess";
import { hasRouteSession } from "./protectedRoute";
import { useSession } from "./session";

export function SignInRedirect() {
  const href = useLocation({
    // The previous route can still render while the login route loads.
    select: (location) => (location.pathname === "/login" ? null : location.href),
  });
  const navigate = useNavigate();
  useEffect(() => {
    if (href) void navigate({ to: "/login", search: () => ({ returnTo: href }), replace: true });
  }, [href, navigate]);
  return null;
}

export function RouteAccess({
  access,
  allowGuest = false,
  children,
}: {
  access?: "admin" | "authoring";
  allowGuest?: boolean;
  children: ReactNode;
}) {
  const session = useSession();
  if (session.isPending) return <LoadingScreen label="Checking account…" />;
  if (session.isError) return <RouteError reset={() => void session.refetch()} />;
  if (!hasRouteSession(session.data, allowGuest)) return <SignInRedirect />;
  if (access && !canAccess(session.data, access)) return <NotFoundPage />;
  return children;
}
