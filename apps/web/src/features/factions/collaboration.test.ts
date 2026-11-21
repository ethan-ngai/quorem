// @vitest-environment happy-dom
/** @file collaboration.test.ts @description Team editor synchronization stays quiet until a notice. @module factions */
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { createCommandSocket } from "../realtime/commandSocket";
import { createTeamCollaboration } from "./collaboration";

vi.mock("../realtime/commandSocket", () => ({ createCommandSocket: vi.fn() }));
afterEach(() => vi.useRealTimers());

it("keeps an idle mounted editor quiet and routes each invalidation to its owner", async () => {
  vi.useFakeTimers();
  const changes = new Set<(kind?: string) => void>();
  const statuses = new Set<(connected: boolean) => void>();
  const request = vi.fn(async (kind: string) =>
    kind === "pull" ? { epoch: "one", version: 0, updates: [] } : [],
  );
  vi.mocked(createCommandSocket).mockReturnValue({
    start: () => statuses.forEach((status) => status(true)),
    stop: () => {},
    request: request as ReturnType<typeof createCommandSocket>["request"],
    onChange(listener) {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    onStatus(listener) {
      statuses.add(listener);
      return () => {
        statuses.delete(listener);
      };
    },
  });
  const refresh = vi.fn();
  const controller = createTeamCollaboration(
    "match",
    {
      team: 2,
      workspaceId: "shared",
      language: "python",
      serverNow: Date.now(),
      document: { source: "abc", epoch: "one", version: 0 },
      members: [],
      votes: [],
      peers: [],
    },
    vi.fn(),
    refresh,
  );
  const view = new EditorView({
    doc: "abc",
    extensions: controller.extension,
    parent: document.body,
  });
  try {
    controller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledWith("pull", { epoch: "one", version: 0 });
    request.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    changes.forEach((change) => change("team.document"));
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledExactlyOnceWith("pull", { epoch: "one", version: 0 });
    request.mockClear();
    changes.forEach((change) => change("team.presence"));
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledExactlyOnceWith("peers");
    changes.forEach((change) => change("team.snapshot"));
    expect(refresh).toHaveBeenCalledOnce();
  } finally {
    view.destroy();
    controller.stop();
  }
});
