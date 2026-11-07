import { matchPreset } from "@quorem/contracts/match-rules";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { participantUserId } from "@quorem/contracts";
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
  command: vi.fn(),
}));
vi.mock("./party", () => ({ useParty: () => partyState, partyCommand: partyState.command }));
vi.mock("./useActiveMatch", () => ({ useActiveMatch: () => ({ match: null }) }));
vi.mock("../completion/CompletionDialog", () => ({
  CompletionDialog: ({
    children,
    actions,
    headerActions,
  }: {
    children: ReactNode;
    actions: ReactNode;
    headerActions: ReactNode;
  }) => (
    <div>
      {headerActions}
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
  rules: { ...matchPreset("casual"), clipboard: "off", focus: "off" },
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
function view() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MatchEndView
        snapshot={snapshot}
        identity="alice"
        open
        onOpenChange={() => {}}
        onReview={() => {}}
      />
    </QueryClientProvider>
  );
}
function render() {
  return renderToStaticMarkup(view());
}
beforeEach(() => {
  partyState.command.mockReset();
  localStorage.clear();
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
  expect(html).not.toContain('aria-label="Leave lobby"');
});

it("leaves only this match's party, exposes failure for retry, then preserves review", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const member = {
    userId: participantUserId("alice"),
    displayName: "Alice",
    ready: false,
    online: true,
  };
  partyState.data = { party: { id: "party", members: [member] } };
  partyState.isPending = false;
  snapshot.partyId = "party";
  const panel = document.createElement("div");
  document.body.append(panel);
  const root = createRoot(panel);
  partyState.command
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(async () => {
      partyState.data = { party: null };
    });
  try {
    await act(async () => root.render(view()));
    const leave = () => panel.querySelector<HTMLButtonElement>('[aria-label="Leave lobby"]')!;
    await act(async () => leave().click());
    expect(panel.textContent).toContain("Could not leave the lobby. Try again.");
    expect(leave().disabled).toBe(false);
    await act(async () => leave().click());
    expect(partyState.command).toHaveBeenNthCalledWith(
      1,
      "alice",
      "/v1/parties/party/leave",
      "POST",
    );
    expect(partyState.command).toHaveBeenCalledTimes(2);
    expect(panel.textContent).toContain("Review code");
    expect(panel.textContent).toContain("Create lobby");
    expect(panel.textContent).not.toContain("Quick ready");
    expect(leave()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    panel.remove();
    delete snapshot.partyId;
    vi.unstubAllGlobals();
  }
});
