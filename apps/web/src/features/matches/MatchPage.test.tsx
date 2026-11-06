// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { MatchSnapshot } from "@quorem/contracts";

const state = vi.hoisted(() => ({ snapshot: undefined as MatchSnapshot | undefined, mounts: 0 }));
vi.mock("./MatchControls", () => ({
  useAccountIdentity: () => ({
    identity: "alice",
    account: { data: { user: { id: "alice" } }, isPending: false },
  }),
}));
vi.mock("../realtime/useMatchSync", () => ({
  useMatchSync: () => ({ snapshot: state.snapshot, status: "live", refetch: vi.fn() }),
}));
vi.mock("../editor/useTheme", () => ({
  useTheme: () => ({ preference: "light", setPreference: vi.fn() }),
}));
vi.mock("../editor/WorkspacePage", async () => {
  const React = await import("react");
  return {
    WorkspacePage: ({ matchHeader }: { matchHeader: React.ReactNode }) => {
      React.useEffect(() => {
        state.mounts++;
      }, []);
      return <div data-workspace="true">{matchHeader}</div>;
    },
  };
});
vi.mock("./MatchEndView", () => ({
  MatchEndView: ({ open, onReview }: { open: boolean; onReview: () => void }) =>
    open ? <button onClick={onReview}>Review code</button> : null,
}));
vi.mock("../rooms/RoomAlerts", () => ({ RoomAlerts: () => null }));
vi.mock("../../ui/Notifications", () => ({ useErrorNotification: () => {} }));
vi.mock("./ConcessionDialog", () => ({ ConcessionDialog: () => null }));
import { MatchPage } from "./MatchPage";

it("keeps the workspace mounted when the match finishes and results reopen", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.mounts = 0;
  state.snapshot = {
    id: "match",
    version: "1",
    state: "active",
    mode: "showdown",
    difficulties: ["easy"],
    rules: { clipboard: "off", focus: "off" },
    ruleEvents: [],
    serverNow: "2026-11-06T12:00:00Z",
    deadline: "2026-11-06T12:30:00Z",
    difficulty: "easy",
    durationMinutes: 30,
    participants: [
      {
        userId: "00000000-0000-4000-8000-000000000001",
        displayName: "Alice",
        ready: true,
        presence: "online",
        workspaceId: "workspace",
      },
    ],
    hostUserId: "alice",
    expiresAt: "2026-11-07T12:00:00Z",
    startedAt: "2026-11-06T12:00:00Z",
    problemVersionId: "version",
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<MatchPage matchId="match" />));
  const workspace = container.querySelector("[data-workspace]");
  state.snapshot = {
    ...state.snapshot,
    state: "completed",
    outcome: { kind: "draw", reason: "deadline", completedAt: "2026-11-06T12:30:00Z" },
  };
  await act(async () => root.render(<MatchPage matchId="match" />));
  expect(container.querySelector("[data-workspace]")).toBe(workspace);
  expect(state.mounts).toBe(1);
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Review code")!
      .click(),
  );
  expect(container.textContent).not.toContain("Review code");
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Results")!
      .click(),
  );
  expect(container.textContent).toContain("Review code");
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
