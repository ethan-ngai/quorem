/** @file RouteAccess.tsx @description Keeps protected pages gated after session changes. @module auth */
import { Navigate, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { RouteError } from "../../ui/RouteError";
import { NotFoundPage } from "../public/NotFoundPage";
import { canAccess } from "./adminAccess";
import { useSession } from "./session";

export function RouteAccess({
  access,
  children,
}: {
  access: "admin" | "authoring";
  children: ReactNode;
}) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <LoadingScreen label="Checking account…" />;
  if (session.isError) return <RouteError reset={() => void session.refetch()} />;
  if (!session.data || session.data.kind === "guest")
    return (
      <Navigate
        to="/login"
        search={(previous) => ({ ...previous, returnTo: location.href })}
        replace
      />
    );
  if (!canAccess(session.data, access)) return <NotFoundPage />;
  return children;
}
