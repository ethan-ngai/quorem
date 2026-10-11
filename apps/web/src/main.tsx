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
import { WorkspacePage } from "./features/editor/WorkspacePage";
import "@quorem/ui/theme.css";
import "./styles/global.css";

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
  beforeLoad: () => { throw redirect({ to: "/$slug", params: { slug: "run-widths" } }); },
});
const problemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$slug",
  component: function ProblemRoute() {
    const { slug } = problemRoute.useParams();
    return <WorkspacePage slug={slug} />;
  },
});
const routeTree = rootRoute.addChildren([indexRoute, problemRoute]);
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
