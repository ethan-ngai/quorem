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
import { sessionQueryOptions, type Session } from "./features/auth/session";
import { primeProfile } from "./features/auth/profile";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { InvitePage } from "./features/matches/InvitePage";
import { practiceSearch } from "./features/navigation/matchCreationIntent";
import { catalogSearch } from "./features/practice/catalogSearch";
import { problemQueryOptions } from "./features/practice/problemQueries";
import { loadWorkspacePage } from "./features/editor/preloadWorkspace";
import { PracticeBrowser } from "./features/practice/PracticeBrowser";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@quorem/ui/theme.css";
import "./styles/global.css";
import "./features/matches/competitive.css";

initializeTheme();

const loadQuestionEditor = () =>
  import("./features/admin/QuestionEditor").then((module) => ({ default: module.QuestionEditor }));
const QuestionEditor = lazy(loadQuestionEditor);

const WorkspacePage = lazy(loadWorkspacePage);
const loadLegalPage = () =>
  import("./features/public/LegalPage").then((module) => ({ default: module.LegalPage }));
const LegalPage = lazy(loadLegalPage);
const loadMatchPage = () =>
  import("./features/matches/MatchPage").then((module) => ({ default: module.MatchPage }));
const MatchPage = lazy(loadMatchPage);

const loadInterviewHub = () =>
  import("./features/interviews/InterviewHub").then((module) => ({ default: module.InterviewHub }));
const InterviewHub = lazy(loadInterviewHub);
const loadInterviewPage = () =>
  import("./features/interviews/InterviewPage").then((module) => ({
    default: module.InterviewPage,
  }));
const InterviewPage = lazy(loadInterviewPage);
const loadInterviewInvite = () =>
  import("./features/interviews/InterviewInvite").then((module) => ({
    default: module.InterviewInvite,
  }));
const InterviewInvite = lazy(loadInterviewInvite);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});
void queryClient.prefetchQuery(sessionQueryOptions());
primeProfile();

const rootRoute = createRootRoute({ component: PageLayout, notFoundComponent: NotFoundPage });
const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  loader: () => loadLegalPage().then(() => undefined),
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening privacy policy…" />}>
      <LegalPage key="privacy" document="privacy" />
    </Suspense>
  ),
});
const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  loader: () => loadLegalPage().then(() => undefined),
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
  loader: ({ params }) => {
    // Public detail reads can overlap chunk and session loading; private reads still require identity.
    const session = queryClient.getQueryData<Session | null>(["auth-session"]);
    const actor = session?.user.id as DevelopmentIdentity | undefined;
    if (
      !actor ||
      !queryClient.getQueryData(problemQueryOptions(queryClient, actor, params.slug).queryKey)
    )
      void queryClient.prefetchQuery(problemQueryOptions(queryClient, "anonymous", params.slug));
    return loadWorkspacePage().then(() => undefined);
  },
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
  loader: () => loadMatchPage().then(() => undefined),
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
  loader: () => loadQuestionEditor().then(() => undefined),
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening question editor…" />}>
      <QuestionEditor />
    </Suspense>
  ),
});
const interviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/interviews",
  loader: () => loadInterviewHub().then(() => undefined),
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening interviews…" />}>
      <InterviewHub />
    </Suspense>
  ),
});
const interviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/interview/$id",
  loader: () => loadInterviewPage().then(() => undefined),
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
  loader: () => loadInterviewInvite().then(() => undefined),
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
