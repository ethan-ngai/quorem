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
  send = vi.fn();
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

it("invalidates on open and change, ignoring stale sockets after reconnect", async () => {
  const changed = vi.fn();
  const stream = submissionStream("alice", "submission", changed);
  stream.start();
  await Promise.resolve();
  const first = Socket.instances[0]!;
  expect(first.protocols).toEqual(["quorem", "bearer.token"]);
  first.onopen?.();
  expect(changed).toHaveBeenCalledTimes(1);
  first.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "heartbeat" },
    }),
  } as MessageEvent);
  first.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "changed" },
    }),
  } as MessageEvent);
  expect(changed).toHaveBeenCalledTimes(2);
  first.onclose?.();
  await vi.advanceTimersByTimeAsync(600);
  const second = Socket.instances[1]!;
  second.onopen?.();
  first.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "changed" },
    }),
  } as MessageEvent);
  second.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "changed" },
    }),
  } as MessageEvent);
  expect(changed).toHaveBeenCalledTimes(4);
  stream.stop();
});
