/** Local notification demo using the actual production navigation and inbox components. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import type { InboxItem, PushPreferences } from "@quorem/contracts/notifications";
import { GlobalNav } from "../features/navigation/GlobalNav";
import { notifyInbox } from "../features/notifications/api";
import "@fontsource-variable/geist";
import "@quorem/ui/theme.css";
import "../styles/global.css";
import "../styles/workspace.css";

if (!import.meta.env.DEV) throw new Error("Development fixture only");
const actor = "demo-account";
const session = {
  kind: "account",
  mode: "development",
  user: { id: actor, displayName: "Alex Chen", emailVerified: true, role: "user" },
};
const initial: InboxItem[] = [
  {
    id: "friend",
    kind: "friend_request",
    sender: { id: "jamie", displayName: "Jamie Park" },
    createdAt: new Date().toISOString(),
    read: false,
  },
  {
    id: "invite",
    kind: "match_invite",
    mode: "showdown",
    sender: { id: "sam", displayName: "Sam Rivera" },
    createdAt: new Date().toISOString(),
    read: false,
  },
];
let items = [...initial];
let preferences: PushPreferences = { friend_request: true, match_invite: false };
const realFetch = window.fetch;
window.fetch = async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  if (path === "/v1/session") return Response.json(session);
  if (path === "/v1/notifications/unread")
    return Response.json({ unread: items.filter(({ read }) => !read).length });
  if (path === "/v1/notifications/open") {
    const snapshot = items;
    items = items.map((item) => ({ ...item, read: true }));
    return Response.json({ items: snapshot, unread: 0 });
  }
  if (path === "/v1/notifications/settings") {
    if (request.method === "PUT") preferences = await request.json();
    return Response.json({ preferences, publicKey: null });
  }
  if (path.startsWith("/v1/notifications/") && request.method === "DELETE") {
    items = items.filter(({ id }) => id !== path.split("/").at(-1));
    return Response.json({ ok: true });
  }
  if (path.startsWith("/v1/friends/") && request.method === "POST") {
    items = items.filter(({ sender }) => sender.id !== path.split("/").at(-1));
    return Response.json({ ok: true });
  }
  if (path === "/v1/notifications/invite/accept-invite") {
    items = items.filter(({ id }) => id !== "invite");
    return Response.json({ id: "demo-lobby" });
  }
  if (path === "/v1/parties/current") return Response.json({ party: null });
  if (path === "/v1/matches/current") return Response.json(null);
  if (path.startsWith("/v1/") || path.startsWith("/api/auth/"))
    return Response.json({ name: "Alex Chen", username: "alex" });
  return realFetch(request);
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
client.setQueryData(["auth-session"], session);
const root = createRootRoute();
const page = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => (
    <>
      <GlobalNav />
      <main className="social-page">
        <header className="social-heading">
          <div>
            <h1>Notifications demo</h1>
            <p>Open the bell beside your profile to view your inbox.</p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              items = [...initial];
              notifyInbox();
            }}
          >
            Reset sample notifications
          </button>
        </header>
      </main>
    </>
  ),
});
const lobby = createRoute({
  getParentRoute: () => root,
  path: "/party",
  component: () => (
    <>
      <GlobalNav />
      <main className="social-page">
        <h1>Sam Rivera’s lobby</h1>
        <p>You accepted the sample invite.</p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void router.navigate({ to: "/" })}
        >
          Back to demo
        </button>
      </main>
    </>
  ),
});
const router = createRouter({
  routeTree: root.addChildren([page, lobby]),
  history: createMemoryHistory(),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
