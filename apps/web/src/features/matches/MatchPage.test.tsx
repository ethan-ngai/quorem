import { matchPreset } from "@quorem/contracts/match-rules";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { MatchSnapshot, PublishedQuestion } from "@quorem/contracts";
import type { MatchSyncStatus } from "../realtime/useMatchSync";

const state = vi.hoisted(() => ({
  snapshot: undefined as MatchSnapshot | undefined,
  error: undefined as Error | undefined,
  mounts: 0,
  status: "live" as MatchSyncStatus,
  notify: vi.fn(),
  saveDraft: vi.fn<() => Promise<void>>(),
  forfeit: vi.fn(),
}));
vi.mock("./MatchControls", () => ({
  useAccountIdentity: () => ({
    identity: "alice",
    account: { data: { user: { id: "alice" } }, isPending: false },
  }),
}));
vi.mock("../realtime/useMatchSync", () => ({
  useMatchSync: () => ({
    snapshot: state.snapshot,
    error: state.error,
    status: state.status,
    refetch: vi.fn(),
  }),
}));
vi.mock("../editor/useTheme", () => ({
  useTheme: () => ({ preference: "light", setPreference: vi.fn() }),
}));
vi.mock("../editor/WorkspacePage", async () => {
  const React = await import("react");
  return {
    WorkspacePage: ({
      matchHeader,
      review,
    }: {
      review?: boolean;
      matchHeader:
        | React.ReactNode
        | ((problem: PublishedQuestion, saveDraft: () => Promise<void>) => React.ReactNode);
    }) => {
      React.useEffect(() => {
        state.mounts++;
      }, []);
      return (
        <div data-workspace="true" data-review={review}>
          {typeof matchHeader === "function"
            ? matchHeader({ title: "Two Sum" } as PublishedQuestion, state.saveDraft)
            : matchHeader}
        </div>
      );
    },
  };
});
vi.mock("./MatchEndView", () => ({
  MatchEndView: ({ open, onReview }: { open: boolean; onReview: () => void }) =>
    open ? <button onClick={onReview}>Review code</button> : null,
}));
vi.mock("../rooms/RoomAlerts", () => ({ RoomAlerts: () => null }));
vi.mock("../navigation/GlobalNav", () => ({ GlobalNav: () => null }));

vi.mock("../../ui/Notifications", () => ({ useErrorNotification: state.notify }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  forfeitMatch: state.forfeit,
}));
vi.mock("./ConcessionDialog", () => ({
  ConcessionDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>Confirm forfeit</button> : null,
}));
import { MatchPage } from "./MatchPage";

const activeMatch: MatchSnapshot = {
  id: "match",
  version: "1",
  state: "active",
  mode: "showdown",
  difficulties: ["easy"],
  rules: { ...matchPreset("casual"), clipboard: "off", focus: "off" },
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

it("keeps the workspace mounted when the match finishes and results reopen", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.mounts = 0;
  state.snapshot = activeMatch;
  state.status = "connecting";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<MatchPage matchId="match" />));
  const workspace = container.querySelector("[data-workspace]");
  expect(workspace?.getAttribute("data-review")).toBe("false");
  expect(container.textContent).not.toContain("Reconnecting…");
  state.status = "reconnecting";
  await act(async () => root.render(<MatchPage matchId="match" />));
  expect(container.textContent).toContain("Reconnecting…");
  state.status = "live";
  state.snapshot = {
    ...state.snapshot,
    state: "completed",
    reviewPending: true,
    outcome: { kind: "draw", reason: "deadline", completedAt: "2026-11-06T12:30:00Z" },
  };
  await act(async () => root.render(<MatchPage matchId="match" />));
  expect(container.querySelector("[data-workspace]")).toBe(workspace);
  expect(state.mounts).toBe(1);
  expect(workspace?.getAttribute("data-review")).toBe("true");
  expect(container.textContent).toContain("Review code");
  state.snapshot = { ...state.snapshot, reviewPending: false };
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

it("opens finished match results over the review workspace", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.mounts = 0;
  state.notify.mockClear();
  state.error = new Error("Event connection failed");
  state.snapshot = {
    ...activeMatch,
    state: "completed",
    outcome: { kind: "draw", reason: "deadline", completedAt: "2026-11-06T12:30:00Z" },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MatchPage matchId="match" />));
    expect(state.mounts).toBe(1);
    const workspace = container.querySelector('[data-review="true"]');
    expect(workspace?.textContent).toContain("Review code");
    expect(state.notify).not.toHaveBeenCalledWith(expect.any(String));
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Review code")!
        .click(),
    );
    expect(state.mounts).toBe(1);
    expect(container.querySelector('[data-review="true"]')).toBe(workspace);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    state.error = undefined;
    vi.unstubAllGlobals();
  }
});

it("flushes the shared draft before forfeiting a Race", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.snapshot = { ...activeMatch, shareFinalCode: true };
  let finishSave!: () => void;
  state.saveDraft.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MatchPage matchId="match" />));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Forfeit match"]')!.click(),
    );
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Confirm forfeit")!
        .click(),
    );
    expect(state.saveDraft).toHaveBeenCalledOnce();
    expect(state.forfeit).not.toHaveBeenCalled();
    await act(async () => finishSave());
    expect(state.forfeit).toHaveBeenCalledWith("alice", "match");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
