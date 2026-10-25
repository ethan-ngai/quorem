import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createReconnectingSocket } from "./reconnectingSocket";
import { token } from "../auth/session";
vi.mock("../auth/session", () => ({ token: vi.fn(async () => "token") }));

class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  constructor(
    readonly url: string,
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
  Socket.instances = [];
  vi.mocked(token).mockResolvedValue("token");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setup() {
  const callbacks = {
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
  };
  const connection = createReconnectingSocket({
    url: () => "ws://localhost/events",
    timeout: 2000,
    ...callbacks,
  });
  return { connection, ...callbacks };
}

it("recovers token failures and cancels all retries on stop", async () => {
  vi.mocked(token).mockRejectedValueOnce(new Error("offline"));
  const { connection, onError, onDisconnect } = setup();
  connection.start();
  await Promise.resolve();
  expect(onError).toHaveBeenCalledOnce();
  expect(onDisconnect).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(600);
  expect(Socket.instances).toHaveLength(1);
  connection.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
});

it("closes stalled handshakes, fences old frames, and clears the deadline on open", async () => {
  const { connection, onOpen, onMessage, onDisconnect } = setup();
  connection.start();
  await Promise.resolve();
  const old = Socket.instances[0]!;
  expect(old.protocols).toEqual(["quorem", "bearer.token"]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(onDisconnect).toHaveBeenCalledOnce();
  old.onopen?.();
  old.onmessage?.({ data: "closed" } as MessageEvent);
  expect(onOpen).not.toHaveBeenCalled();
  expect(onMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(600);
  const current = Socket.instances[1]!;
  old.onopen?.();
  old.onmessage?.({ data: "stale" } as MessageEvent);
  expect(onOpen).not.toHaveBeenCalled();
  expect(onMessage).not.toHaveBeenCalled();
  current.onopen?.();
  current.onmessage?.({ data: "current" } as MessageEvent);
  expect(onOpen).toHaveBeenCalledOnce();
  expect(onMessage).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(onDisconnect).toHaveBeenCalledOnce();
  connection.stop();
});
