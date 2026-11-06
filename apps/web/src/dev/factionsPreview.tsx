import { useState } from "react";
import { TeamVoteToast } from "../features/factions/TeamVoteToast";
import type { TeamVote } from "@quorem/contracts/factions";
/** @file factionsPreview.tsx @description Local-only fixture for the real Factions lobby components. @module dev */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  createRootRoute,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { PartyPage } from "../features/matches/PartyPage";
import { Notifications } from "../ui/Notifications";
import { matchPreset } from "@quorem/contracts/match-rules";
import type { PartySnapshot } from "@quorem/contracts";
import type { TeamLobby } from "@quorem/contracts/factions";
import "@fontsource-variable/geist";
import "@fontsource/jetbrains-mono/400.css";
import "@quorem/ui/theme.css";
import "../styles/global.css";
import "../styles/workspace.css";
import "../features/matches/competitive.css";
const people = ["Alex", "Blair", "Casey", "Drew"];
const party: PartySnapshot = {
  id: "fixture",
  version: "1",
  hostUserId: "p0",
  currentMatchId: null,
  latestMatchId: null,
  countdownEndsAt: null,
  queueError: null,
  members: people.map((displayName, i) => ({
    userId: `p${i}`,
    displayName,
    joinedAt: "2026-01-01T00:00:00Z",
    ready: false,
    online: true,
  })),
  settings: {
    mode: "factions",
    durationMinutes: 30,
    difficulties: ["easy"],
    shareCodeAfterMatch: true,
    rules: matchPreset("balanced"),
  },
};
let teams: TeamLobby = {
  teamCount: 2,
  assignments: people.map((_, i) => ({ userId: `p${i}`, team: i < 3 ? 1 : 2 })),
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
      user: { id: "p0", displayName: "Alex", emailVerified: true, role: "user" },
    });
  if (path === "/v1/matches/current") return reply(null);
  if (path === "/v1/problems") return reply({ items: [] });
  if (path.endsWith("/teams")) {
    if (request.method === "POST") {
      const b = await request.json();
      if (b.action === "assign")
        teams = {
          ...teams,
          assignments: teams.assignments.map((m) =>
            m.userId === b.userId ? { ...m, team: b.team } : m,
          ),
        };
      if (b.action === "count") teams = { ...teams, teamCount: b.count };
      if (b.action === "balance")
        teams = {
          ...teams,
          assignments: teams.assignments.map((m, i) => ({ ...m, team: (i % teams.teamCount) + 1 })),
        };
      party.members.forEach((m) => (m.ready = false));
    }
    return reply(teams);
  }
  if (path.endsWith("/ready")) {
    const b = await request.json();
    party.members[0]!.ready = b.ready;
  }
  if (path.endsWith("/settings")) party.settings = await request.json();
  return reply({ party });
};
const client = new QueryClient();
function Preview() {
  const [vote, setVote] = useState<TeamVote>();
  return (
    <>
      <Notifications />
      <PartyPage />
      <aside
        style={{ position: "fixed", bottom: 16, left: 80, zIndex: 10 }}
        aria-label="Fixture controls"
      >
        <button
          className="button button-secondary"
          onClick={() =>
            setVote({
              id: crypto.randomUUID(),
              proposerId: "p1",
              electorate: ["p0", "p1", "p2"],
              ballots: { p1: true },
              quote: {
                action: { kind: "reveal", target: "complexity" },
                ruleVersion: "fixture",
                cost: { seconds: 60, points: 0 },
              },
              state: "pending",
              createdAt: Date.now(),
              expiresAt: Date.now() + 30000,
            })
          }
        >
          Preview team vote
        </button>
        {vote && (
          <TeamVoteToast
            key={vote.id}
            vote={vote}
            identity="p0"
            proposerName="Blair"
            serverNow={Date.now()}
            onVote={async () => setVote(undefined)}
            onCancel={async () => setVote(undefined)}
          />
        )}
      </aside>
    </>
  );
}
const root = createRootRoute({ component: Preview });
const router = createRouter({
  routeTree: root,
  history: createMemoryHistory({ initialEntries: ["/party"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
