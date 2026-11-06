/** Local fixture: real lobby components, simulated membership and settings. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  createRootRoute,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { PartyPage } from "../features/matches/PartyPage";
import { Notifications } from "../ui/Notifications";
import { matchPreset } from "@quorem/contracts/match-rules";
import type { PartySnapshot, DevelopmentIdentity } from "@quorem/contracts";
import type { TeamLobby } from "@quorem/contracts/factions";
import { CreateMatchDialog } from "../features/matches/CreateMatchDialog";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@quorem/ui/theme.css";
import "../styles/global.css";
import "../styles/workspace.css";
import "../features/matches/competitive.css";
if (!import.meta.env.DEV) throw new Error("Development fixture only");
const party: PartySnapshot = {
  id: "lobby-preview",
  version: "1",
  hostUserId: "alex",
  currentMatchId: null,
  latestMatchId: null,
  countdownEndsAt: null,
  queueError: null,
  members: ["alex", "jamie", "sam"].map((userId, i) => ({
    userId,
    displayName: ["Alex", "Jamie", "Sam"][i],
    joinedAt: "2026-01-01T00:00:00Z",
    ready: i !== 0,
    online: true,
  })),
  settings: {
    mode: "free-for-all",
    durationMinutes: 30,
    difficulties: ["easy"],
    shareCodeAfterMatch: true,
    rules: matchPreset(),
  },
};
const preview = new URLSearchParams(location.search);
const identity = preview.get("viewer") === "jamie" ? "jamie" : "alex";
let teams: TeamLobby = {
  teamCount: 2,
  assignments: party.members.map((member, i) => ({ userId: member.userId, team: (i % 2) + 1 })),
};
window.fetch = async (url, options) => {
  const request = new Request(
    new URL(url instanceof Request ? url.url : String(url), location.origin),
    url instanceof Request ? url : options,
  );
  const path = new URL(request.url).pathname;
  const reply = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  if (path === "/api/auth/token") return new Response("", { status: 401 });
  if (path === "/v1/session")
    return reply({
      mode: "development",
      kind: "account",
      user: {
        id: identity,
        displayName: identity === "alex" ? "Alex" : "Jamie",
        emailVerified: true,
        role: "user",
      },
    });
  if (path === "/v1/matches/current") return reply(null);
  if (path === "/v1/problems")
    return reply({
      items: [{ id: "example", title: "Two Sum", difficulty: "easy" }],
      total: 1,
      topics: ["arrays"],
      companies: [],
    });
  if (path.endsWith("/teams")) {
    if (request.method === "POST") {
      const body = await request.json();
      if (body.action === "assign")
        teams.assignments = teams.assignments.map((member) =>
          member.userId === body.userId ? { ...member, team: body.team } : member,
        );
      if (body.action === "count") {
        teams.teamCount = body.count;
        teams.assignments = teams.assignments.map((member) => ({
          ...member,
          team: member.team && member.team > body.count ? null : member.team,
        }));
      }
      if (body.action === "balance")
        teams.assignments = teams.assignments.map((member, i) => ({
          ...member,
          team: (i % teams.teamCount) + 1,
        }));
      party.members.forEach((member) => (member.ready = false));
    }
    return reply(teams);
  }
  if (path.endsWith("/ready"))
    party.members.find((member) => member.userId === identity)!.ready = (
      await request.json()
    ).ready;
  if (path.endsWith("/settings")) {
    party.settings = await request.json();
    party.members.forEach((member) => (member.ready = false));
  }
  return reply({ party: preview.has("create") ? null : party });
};
function Preview() {
  return (
    <>
      <Notifications />
      {preview.has("create") ? (
        <CreateMatchDialog identity={identity as DevelopmentIdentity} onClose={() => {}} />
      ) : (
        <PartyPage />
      )}
      <span className="lobby-fixture-label">Local preview · simulated players</span>
    </>
  );
}
const route = createRootRoute({ component: Preview });
const router = createRouter({
  routeTree: route,
  history: createMemoryHistory({ initialEntries: ["/party"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
