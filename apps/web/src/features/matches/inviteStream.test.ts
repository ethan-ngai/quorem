/** @file inviteStream.test.ts @description Public invitation liveness and refresh behavior. @module matches */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inviteStream } from "./inviteStream";
import { token } from "../auth/session";

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
  vi.clearAllMocks();
});

it("ignores heartbeat for preview reads and reconnects a silently dead stream", async () => {
  const refresh = vi.fn();
  const stream = inviteStream("token", refresh);
  stream.start();
  expect(token).not.toHaveBeenCalled();
  const first = Socket.instances[0]!;
  expect(first.protocols).toEqual(["quorem"]);
  first.onopen?.();
  first.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "changed" },
    }),
  } as MessageEvent);
  expect(refresh).toHaveBeenCalledTimes(1);
  first.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "heartbeat" },
    }),
  } as MessageEvent);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(45_601);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(Socket.instances).toHaveLength(2);
  const second = Socket.instances[1]!;
  second.onopen?.();
  first.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "changed" },
    }),
  } as MessageEvent);
  expect(refresh).toHaveBeenCalledTimes(2);
  second.onmessage?.({
    data: JSON.stringify({
      receipt: "12345678-1234-4123-8123-123456789012",
      payload: { type: "changed" },
    }),
  } as MessageEvent);
  expect(refresh).toHaveBeenCalledTimes(3);
  stream.stop();
});
