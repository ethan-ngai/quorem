/** @file submissionStream.test.ts @description Snapshot isolation and reconnect recovery. @module editor */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { submissionStream } from "./submissionStream";

vi.mock("../auth/session", () => ({ token: vi.fn(async () => "token"), tokenExpiresAt: vi.fn() }));

class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  constructor(
    readonly url: URL,
    readonly protocols: string[],
  ) {
    Socket.instances.push(this);
  }
  close() {
    this.onclose?.();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", { location: { origin: "https://quorem.test" } });
  Socket.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("rejects other workspaces and restores the current snapshot after reconnect", async () => {
  const snapshots = vi.fn();
  const stream = submissionStream("alice", "submission", "workspace", snapshots);
  stream.start();
  await Promise.resolve();
  const first = Socket.instances[0]!;
  expect(first.protocols).toEqual(["quorem", "bearer.token"]);
  first.onopen?.();
  const snapshot = {
    id: "submission",
    workspaceId: "workspace",
    state: "queued",
    kind: "run",
    sourceHash: "hash",
    admittedAt: "date",
    updatedAt: "date",
  };
  first.onmessage?.({
    data: JSON.stringify({ ...snapshot, workspaceId: "other" }),
  } as MessageEvent);
  expect(snapshots).not.toHaveBeenCalled();
  first.onmessage?.({ data: JSON.stringify(snapshot) } as MessageEvent);
  expect(snapshots).toHaveBeenCalledWith(snapshot);
  first.onclose?.();
  await vi.advanceTimersByTimeAsync(600);
  const second = Socket.instances[1]!;
  second.onopen?.();
  first.onmessage?.({ data: JSON.stringify(snapshot) } as MessageEvent);
  const completed = { ...snapshot, state: "completed" };
  second.onmessage?.({ data: JSON.stringify(completed) } as MessageEvent);
  expect(snapshots).toHaveBeenCalledTimes(2);
  expect(snapshots).toHaveBeenLastCalledWith(completed);
  stream.stop();
});
