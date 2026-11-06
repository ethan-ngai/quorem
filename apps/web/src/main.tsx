import { questionSearch } from "./features/admin/questionSearch";
/** @file main.tsx @description Mounts the editor workspace router and query cache. @module web */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { StrictMode, Suspense, lazy } from "react";
import { initializeTheme } from "./features/editor/useTheme";
import { LoadingScreen } from "./ui/LoadingScreen";
import { SudoDialog } from "./features/auth/SudoDialog";
import { Notifications } from "./ui/Notifications";
import { RouteError } from "./ui/RouteError";
import { NotFoundPage } from "./features/public/NotFoundPage";
import { PageLayout } from "./features/navigation/PageLayout";
import { createRoot, type Root } from "react-dom/client";
import { LoginPage } from "./features/auth/LoginPage";
import { sessionQueryOptions, type Session } from "./features/auth/session";
import { requireAdminAccess, requireAuthoringAccess } from "./features/auth/adminAccess";
import { RouteAccess } from "./features/auth/RouteAccess";
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

const loadAdminDashboard = () =>
  import("./features/admin/AdminDashboard").then((module) => ({ default: module.AdminDashboard }));
const AdminDashboard = lazy(loadAdminDashboard);

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
const SocialPage = lazy(() =>
  import("./features/social/SocialPage").then((module) => ({ default: module.SocialPage })),
);
const socialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/social",
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening social…" />}>
      <SocialPage />
    </Suspense>
  ),
});
const playerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/players/$id",
  component: function PlayerRoute() {
    const { id } = playerRoute.useParams();
    return (
      <Suspense fallback={<LoadingScreen label="Opening profile…" />}>
        <SocialPage playerId={id} />
      </Suspense>
    );
  },
});
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
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/match/$id/review",
  component: function ReviewRoute() {
    const { id } = reviewRoute.useParams();
    return (
      <Suspense fallback={<LoadingScreen label="Opening review…" />}>
        <MatchPage matchId={id} reviewEntry />
      </Suspense>
    );
  },
});
const partyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/party",
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening lobby…" />}>
      <PartyPage />
    </Suspense>
  ),
});
const PartyPage = lazy(() =>
  import("./features/matches/PartyPage").then((module) => ({ default: module.PartyPage })),
);
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
  path: "/admin",
  beforeLoad: ({ location }) => requireAdminAccess(queryClient, location.href),
  component: () => (
    <RouteAccess access="admin">
      <Outlet />
    </RouteAccess>
  ),
});
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  loader: () => loadAdminDashboard().then(() => undefined),
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening admin dashboard…" />}>
      <AdminDashboard />
    </Suspense>
  ),
});
const adminUnknownRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "$",
  component: NotFoundPage,
});
const questionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/questions",
  validateSearch: questionSearch,
  beforeLoad: async ({ location, search }) => {
    await requireAuthoringAccess(queryClient, location.href);
    if (new URLSearchParams(location.searchStr).get("section") !== search.section)
      throw redirect({ to: "/questions", search, hash: location.hash, replace: true });
  },
  loader: () => loadQuestionEditor().then(() => undefined),
  component: () => (
    <Suspense fallback={<LoadingScreen label="Opening question editor…" />}>
      <RouteAccess access="authoring">
        <QuestionEditor />
      </RouteAccess>
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
const CompletionDemo = lazy(() =>
  import("./features/completion/CompletionDemo").then((module) => ({
    default: module.CompletionDemo,
  })),
);
const completionDemoRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/dev/completion",
        component: () => (
          <Suspense fallback={<LoadingScreen label="Opening demo…" />}>
            <CompletionDemo />
          </Suspense>
        ),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  ...completionDemoRoutes,
  privacyRoute,
  termsRoute,
  interviewsRoute,
  interviewRoute,
  interviewInviteRoute,
  adminRoute.addChildren([adminIndexRoute, adminUnknownRoute]),
  questionsRoute,
  indexRoute,
  loginRoute,
  practiceRoute,
  problemRoute,
  matchRoute,
  reviewRoute,
  partyRoute,
  socialRoute,
  playerRoute,
  inviteRoute,
]);
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultErrorComponent: RouteError,
});

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
      <SudoDialog />
      <Notifications />
    </QueryClientProvider>
  </StrictMode>,
);
