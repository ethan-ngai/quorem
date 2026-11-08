import { organizeFactionFixture, saveFixtureSettings } from "./factionLobbyFixture";
/** Local fixture: real lobby components, simulated membership and settings. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  createRouter,
  createRootRoute,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { InvitePage } from "../features/matches/InvitePage";
import { PartyPage } from "../features/matches/PartyPage";
import { savePartyInvitation } from "../features/matches/party";
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
const guestJoin = preview.has("guest-join");
let guest: PartySnapshot["members"][number] | undefined;
if (guestJoin) {
  party.settings.mode = "showdown";
  party.settings.accessMode = "guests_allowed";
  party.members = party.members.slice(0, 1);
}
if (preview.has("invite")) savePartyInvitation(party.id, "/invite/lobby-preview");
if (preview.has("factions") || preview.has("locked")) party.settings.mode = "factions";
if (preview.has("locked")) {
  party.settings.admissionLocked = true;
  party.settings.factionChangesLocked = true;
}
if (preview.has("ready"))
  party.members.forEach((member) => {
    member.ready = true;
  });
const identity = preview.get("viewer") === "jamie" ? "jamie" : "alex";
let teams: TeamLobby = {
  teamCount: 2,
  assignments: party.members.map((member, i) => ({ userId: member.userId, team: (i % 2) + 1 })),
};
if (preview.has("empty")) teams.teamCount = 3;
const previousMode = preview.get("previous");
if (previousMode) {
  party.latestMatchId = "previous-match";
  party.members.forEach((member, index) => {
    member.previousWinner =
      previousMode === "factions" ? index % 2 === 0 : member.userId === "jamie";
  });
}
window.fetch = async (url, options) => {
  const request = new Request(
    new URL(url instanceof Request ? url.url : String(url), location.origin),
    url instanceof Request ? url : options,
  );
  const path = new URL(request.url).pathname;
  if (preview.has("slow") && request.method !== "GET")
    await new Promise((resolve) => setTimeout(resolve, 1000));
  const reply = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  if (path === "/api/auth/token") return new Response("", { status: 401 });
  if (guestJoin) {
    if (path === `/v1/parties/invitations/${party.id}`)
      return reply({
        id: party.id,
        participantCount: party.members.length,
        capacity: 2,
        guestAllowed: true,
        matchSetup: {
          mode: party.settings.mode,
          difficulties: party.settings.difficulties,
          durationMinutes: party.settings.durationMinutes,
          rules: party.settings.rules,
          shareCodeAfterMatch: party.settings.shareCodeAfterMatch,
        },
      });
    if (path === "/v1/guest-sessions") return new Response(null, { status: 204 });
    if (path === `/v1/parties/invitations/${party.id}/guest`) {
      const { name } = await request.json();
      guest = {
        userId: "guest",
        displayName: name,
        joinedAt: new Date().toISOString(),
        ready: false,
        online: true,
      };
      party.members.push(guest);
      return reply(party);
    }
    if (path === "/v1/session")
      return guest
        ? reply({
            mode: "development",
            kind: "guest",
            user: { id: guest.userId, displayName: guest.displayName, role: "user" },
          })
        : new Response(null, { status: 401 });
  }
  if (path === "/v1/session")
    return reply({
      mode: "development",
      kind: "account",
      capabilities: { hostGuests: preview.has("guest-host") },
      user: {
        id: identity,
        displayName: identity === "alex" ? "Alex" : "Jamie",
        emailVerified: true,
        role: "user",
      },
    });
  if (path === "/v1/matches/current") return reply(null);
  if (path === "/v1/problems") {
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    const limit = Number(params.get("limit") ?? 30);
    const items = Array.from({ length: 75 }, (_, index) => ({
      id: index === 0 ? "example" : `fixture-${index}`,
      title: index === 0 ? "Two Sum" : `Example question ${String(index + 1).padStart(2, "0")}`,
      difficulty: "easy",
    })).filter((item) => item.title.toLowerCase().includes((params.get("q") ?? "").toLowerCase()));
    return reply({
      items: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      topics: ["arrays"],
      companies: [],
    });
  }
  if (path.endsWith("/teams")) {
    if (request.method === "POST")
      teams = organizeFactionFixture(party, teams, await request.json());
    return reply(teams);
  }
  if (path.endsWith("/kick")) {
    const { userId } = await request.json();
    party.members = party.members.filter((member) => member.userId !== userId);
    teams.assignments = teams.assignments.filter((member) => member.userId !== userId);
    party.members.forEach((member) => (member.ready = false));
  }
  if (path.endsWith("/ready"))
    party.members.find((member) => member.userId === identity)!.ready = (
      await request.json()
    ).ready;
  if (path.endsWith("/settings")) {
    if (preview.has("reject-settings")) return new Response("", { status: 409 });
    return reply(saveFixtureSettings(party, await request.json()));
  }
  return reply({ party: preview.has("create") ? null : party });
};
function Preview() {
  const client = useQueryClient();
  const [joined, setJoined] = useState(false);
  return (
    <>
      <Notifications />
      {guestJoin && !joined ? (
        <InvitePage
          token={party.id}
          onJoined={() => {
            void client.resetQueries({ queryKey: ["auth-session"] });
            setJoined(true);
          }}
        />
      ) : preview.has("create") ? (
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
  history: createMemoryHistory({ initialEntries: [guestJoin ? `/invite/${party.id}` : "/party"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
