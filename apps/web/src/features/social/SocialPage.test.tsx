import { requireData } from "../../api/client";
/** @file SocialPage.test.tsx @description Account isolation, empty rivalry and profile perspective. @module social */
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { SocialPage } from "./SocialPage";
vi.mock("../navigation/GlobalNav", () => ({ GlobalNav: () => null }));
vi.mock("../editor/useTheme", () => ({
  useTheme: () => ({ preference: "light", setPreference: () => {} }),
}));
vi.mock("../../ui/SearchField", () => ({
  SearchField: () => <input aria-label="Search players" />,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    search: _search,
    ...props
  }: {
    to: string;
    params?: { id: string };
    search?: unknown;
    children: ReactNode;
  }) => (
    <a href={to.replace("$id", params?.id ?? "")} {...props}>
      {children}
    </a>
  ),
}));
const player = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Rival",
  username: "rivalhandle",
  image: "",
  color: 1,
};
const zero = { played: 0, wins: 0, draws: 0, losses: 0 };
function setup(signedIn = true) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  cache.setQueryData(
    ["auth-session"],
    signedIn ? { kind: "account", user: { id: "viewer" } } : null,
  );
  cache.setQueryData(["social", "viewer"], {
    viewer: player,
    windowDays: 90,
    minimumMatches: 3,
    rivals: [],
  });
  cache.setQueryData(["players", "viewer", "", 0], { items: [], total: 0 });
  return {
    cache,
    render: (id?: string) =>
      renderToStaticMarkup(
        <QueryClientProvider client={cache}>
          <SocialPage playerId={id} />
        </QueryClientProvider>,
      ),
  };
}
it("explains the rivalry threshold and an empty directory", () => {
  const { render } = setup();
  const html = render();
  expect(html).toContain("Complete three Showdowns");
  expect(html).toContain("No players found");
  expect(html).toContain("0 entries");
});
it("does not render cached social data after sign-out", () => {
  const { cache, render } = setup(false);
  cache.setQueryData(["social", "viewer"], { viewer: player, rivals: [{ player, record: zero }] });
  const html = render();
  expect(html).toContain("Sign in");
  expect(html).not.toContain("Rival</span>");
});
it("links automatic rivals and reports viewer-perspective records", () => {
  const { cache, render } = setup();
  cache.setQueryData(["social", "viewer"], {
    viewer: player,
    windowDays: 90,
    minimumMatches: 3,
    rivals: [
      {
        player,
        record: { played: 4, wins: 1, draws: 1, losses: 2 },
        lastPlayedAt: "2026-11-06T12:00:00Z",
      },
    ],
  });
  const html = render();
  expect(html).toContain(`/players/${player.id}`);
  expect(html).toContain("Your wins, draws and losses");
  expect(html).toContain("@rivalhandle");
  expect(html).not.toContain("Other rivalries");
});
it("distinguishes a player's record from the viewer's head-to-head, hiding self comparison", () => {
  const { cache, render } = setup();
  const profile = {
    player,
    windowDays: 90,
    record: { played: 4, wins: 2, draws: 1, losses: 1 },
    headToHead: { played: 4, wins: 1, draws: 1, losses: 2 },
    isSelf: false,
  };
  cache.setQueryData(["player", "viewer", player.id], profile);
  expect(render(player.id)).toContain("You vs. Rival");
  cache.setQueryData(["player", "viewer", player.id], { ...profile, isSelf: true });
  expect(render(player.id)).not.toContain("You vs.");
});

it("hides cached profile data when the server revokes visibility", async () => {
  const { cache, render } = setup();
  const queryKey = ["player", "viewer", player.id];
  cache.setQueryData(queryKey, {
    player,
    windowDays: 90,
    record: zero,
    headToHead: zero,
    isSelf: false,
  });
  await cache
    .fetchQuery({
      queryKey,
      staleTime: 0,
      queryFn: () => {
        return requireData(undefined, {
          error: { code: "not_found", message: "Player unavailable" },
        });
      },
    })
    .catch(() => {});
  const html = render(player.id);
  expect(html).toContain("This player is unavailable");
  expect(html).not.toContain("You vs. Rival");
});

it("renders usernames instead of raw IDs in directory and profiles", () => {
  const { cache, render } = setup();
  cache.setQueryData(["players", "viewer", "", 0], { items: [player], total: 1 });
  const text = render().replace(/<[^>]*>/g, "");
  expect(text).toContain("@rivalhandle");
  expect(text).not.toContain(player.id);
  expect(text).not.toContain("Player ID");
  cache.setQueryData(["player", "viewer", player.id], {
    player,
    windowDays: 90,
    record: zero,
    headToHead: zero,
    isSelf: false,
  });
  expect(render(player.id).replace(/<[^>]*>/g, "")).not.toContain(player.id);
  cache.setQueryData(["player", "viewer", player.id], {
    player: { ...player, username: null },
    windowDays: 90,
    record: zero,
    headToHead: zero,
    isSelf: false,
  });
  expect(render(player.id)).not.toContain("@null");
});
