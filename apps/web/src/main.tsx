/** @file main.tsx @description Mounts the editor workspace router and query cache. @module web */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode, Suspense, lazy } from "react";
import { initializeTheme } from "./features/editor/useTheme";
import { LoadingScreen } from "./ui/LoadingScreen";
import { Notifications } from "./ui/Notifications";
import { NotFoundPage } from "./features/public/NotFoundPage";
import { PageLayout } from "./features/navigation/PageLayout";
import { createRoot, type Root } from "react-dom/client";
import { LoginPage } from "./features/auth/LoginPage";
import { InvitePage } from "./features/matches/InvitePage";
import { practiceSearch } from "./features/navigation/matchCreationIntent";
import { catalogSearch } from "./features/practice/catalogSearch";
import { loadWorkspacePage } from "./features/editor/preloadWorkspace";
import { PracticeBrowser } from "./features/practice/PracticeBrowser";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@quorem/ui/theme.css";
import "./styles/global.css";
import "./features/matches/competitive.css";

initializeTheme();

const QuestionEditor = lazy(() =>
  import("./features/admin/QuestionEditor").then((module) => ({ default: module.QuestionEditor })),
);

const WorkspacePage = lazy(loadWorkspacePage);
const LegalPage = lazy(() =>
  import("./features/public/LegalPage").then((module) => ({ default: module.LegalPage })),
);
const MatchPage = lazy(() =>
  import("./features/matches/MatchPage").then((module) => ({ default: module.MatchPage })),
);

const InterviewHub = lazy(() =>
  import("./features/interviews/InterviewHub").then((module) => ({ default: module.InterviewHub })),
);
const InterviewPage = lazy(() =>
  import("./features/interviews/InterviewPage").then((module) => ({
    default: module.InterviewPage,
  })),
);
const InterviewInvite = lazy(() =>
  import("./features/interviews/InterviewInvite").then((module) => ({
    default: module.InterviewInvite,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const rootRoute = createRootRoute({ component: PageLayout, notFoundComponent: NotFoundPage });
const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening privacy policy…" />}>
      <LegalPage key="privacy" document="privacy" />
    </Suspense>
  ),
});
const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening terms of service…" />}>
      <LegalPage key="terms" document="terms" />
    </Suspense>
  ),
});
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
  validateSearch: (search) => ({ ...practiceSearch(search), ...catalogSearch(search) }),
  component: PracticeBrowser,
});
const problemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/$slug",
  component: function ProblemRoute() {
    const { slug } = problemRoute.useParams();
    return (
      <Suspense fallback={<LoadingScreen label="Opening workspace…" />}>
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
      <Suspense fallback={<LoadingScreen label="Opening match…" />}>
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
    <Suspense fallback={<LoadingScreen label="Opening question editor…" />}>
      <QuestionEditor />
    </Suspense>
  ),
});
const interviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/interviews",
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening interviews…" />}>
      <InterviewHub />
    </Suspense>
  ),
});
const interviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/interview/$id",
  component: function InterviewRoute() {
    const { id } = interviewRoute.useParams();
    return (
      <Suspense fallback={<LoadingScreen label="Opening interview…" />}>
        <InterviewPage id={id} />
      </Suspense>
    );
  },
});
const interviewInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/interview-invite/$token",
  component: function InterviewInviteRoute() {
    const { token } = interviewInviteRoute.useParams();
    return (
      <Suspense fallback={<LoadingScreen label="Opening invitation…" />}>
        <InterviewInvite token={token} />
      </Suspense>
    );
  },
});
const routeTree = rootRoute.addChildren([
  privacyRoute,
  termsRoute,
  interviewsRoute,
  interviewRoute,
  interviewInviteRoute,
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

// Entry-module HMR reuses the mounted root instead of creating a competing React tree.
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Notifications />
    </QueryClientProvider>
  </StrictMode>,
);
