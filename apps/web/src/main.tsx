/** @file main.tsx @description Mounts the editor workspace router and query cache. @module web */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { LoginPage } from "./features/auth/LoginPage";
import { InvitePage } from "./features/matches/InvitePage";
import { practiceSearch } from "./features/navigation/matchCreationIntent";
import { PracticeBrowser } from "./features/practice/PracticeBrowser";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@quorem/ui/theme.css";
import "./styles/global.css";
import "./features/matches/competitive.css";

const QuestionEditor = lazy(() =>
  import("./features/admin/QuestionEditor").then((module) => ({ default: module.QuestionEditor })),
);

const WorkspacePage = lazy(() =>
  import("./features/editor/WorkspacePage").then((module) => ({ default: module.WorkspacePage })),
);
const MatchPage = lazy(() =>
  import("./features/matches/MatchPage").then((module) => ({ default: module.MatchPage })),
);

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
  component: () => (
    <a className="text-link" href="/">
      Open Quorem home
    </a>
  ),
});
const practiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice",
  validateSearch: practiceSearch,
  component: PracticeBrowser,
});
const problemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/$slug",
  component: function ProblemRoute() {
    const { slug } = problemRoute.useParams();
    return (
      <Suspense
        fallback={
          <main className="workspace-loading" role="status">
            Opening workspace…
          </main>
        }
      >
        <WorkspacePage slug={slug} />
      </Suspense>
    );
  },
});
const matchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/match/$id",
  component: function MatchRoute() {
    const { id } = matchRoute.useParams();
    return (
      <Suspense
        fallback={
          <main className="workspace-loading" role="status">
            Opening match…
          </main>
        }
      >
        <MatchPage matchId={id} />
      </Suspense>
    );
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
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/questions",
  component: () => (
    <Suspense
      fallback={
        <main className="admin-access" role="status">
          Opening question editor…
        </main>
      }
    >
      <QuestionEditor />
    </Suspense>
  ),
});
const routeTree = rootRoute.addChildren([
  adminRoute,
  indexRoute,
  loginRoute,
  practiceRoute,
  problemRoute,
  matchRoute,
  inviteRoute,
]);
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
