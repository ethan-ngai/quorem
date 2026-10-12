/** @file main.tsx @description Mounts the editor workspace router and query cache. @module web */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MatchPage } from "./features/matches/MatchPage";
import { InvitePage } from "./features/matches/InvitePage";
import { WorkspacePage } from "./features/editor/WorkspacePage";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@quorem/ui/theme.css";
import "./styles/global.css";
import "./features/matches/competitive.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/$slug", params: { slug: "run-widths" } });
  },
});
const problemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$slug",
  component: function ProblemRoute() {
    const { slug } = problemRoute.useParams();
    return <WorkspacePage slug={slug} />;
  },
});
const matchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/matches/$id",
  component: function MatchRoute() {
    const { id } = matchRoute.useParams();
    return <MatchPage matchId={id} />;
  },
});
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: function InviteRoute() {
    const { token } = inviteRoute.useParams();
    return <InvitePage token={token} />;
  },
});
const routeTree = rootRoute.addChildren([indexRoute, problemRoute, matchRoute, inviteRoute]);
const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
