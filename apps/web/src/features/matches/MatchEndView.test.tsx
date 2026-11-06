import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { MatchSnapshot } from "@quorem/contracts";
import type { ReactNode } from "react";

const partyState = vi.hoisted(() => ({
  data: undefined as { party: unknown } | undefined,
  isPending: true,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));
vi.mock("./party", () => ({ useParty: () => partyState, partyCommand: vi.fn() }));
vi.mock("./useActiveMatch", () => ({ useActiveMatch: () => ({ match: null }) }));
vi.mock("../completion/CompletionDialog", () => ({
  CompletionDialog: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <div>
      {children}
      {actions}
    </div>
  ),
}));
import { MatchEndView } from "./MatchEndView";

const snapshot: MatchSnapshot = {
  id: "match",
  version: "1",
  state: "completed",
  mode: "showdown",
  difficulties: ["easy"],
  rules: { clipboard: "off", focus: "off" },
  ruleEvents: [],
  serverNow: "2026-11-06T12:00:00Z",
  difficulty: "easy",
  durationMinutes: 30,
  participants: [],
  hostUserId: "host",
  expiresAt: "2026-11-07T12:00:00Z",
  startedAt: "2026-11-06T11:00:00Z",
  outcome: { kind: "draw", reason: "deadline", completedAt: "2026-11-06T11:30:00Z" },
};
function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MatchEndView
        snapshot={snapshot}
        identity="alice"
        open
        onOpenChange={() => {}}
        onReview={() => {}}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  partyState.data = undefined;
  partyState.isPending = true;
  partyState.isError = false;
  partyState.isFetching = false;
});
it("waits for authoritative absence before offering creation", () => {
  expect(render()).toContain("Checking lobby");
  expect(render()).not.toContain("Create lobby");
  partyState.data = { party: null };
  partyState.isPending = false;
  const html = render();
  expect(html).toContain('href="/practice?create=match"');
  expect(html).toContain("Review code");
  partyState.isFetching = true;
  expect(render()).not.toContain("Create lobby");
});
it("offers recovery instead of creation when the party lookup fails", () => {
  partyState.data = { party: null };
  partyState.isPending = false;
  partyState.isError = true;
  const html = render();
  expect(html).not.toContain("Create lobby");
  expect(html).toContain("Could not check your lobby");
  expect(html).toContain("Lobby unavailable");
});
it("returns to a different current party while retaining round review", () => {
  partyState.data = { party: { id: "other" } };
  partyState.isPending = false;
  const html = render();
  expect(html).toContain('href="/party"');
  expect(html).toContain("Review code");
  expect(html).not.toContain("Create lobby");
});
