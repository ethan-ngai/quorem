import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createReconnectingSocket } from "./reconnectingSocket";
import { token, tokenExpiresAt } from "../auth/session";
vi.mock("../auth/session", () => ({ token: vi.fn(async () => "token"), tokenExpiresAt: vi.fn() }));

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

it("connects public streams without requesting account credentials", async () => {
  const connection = createReconnectingSocket({
    url: () => "ws://localhost/public-events",
    timeout: 2000,
    authenticate: false,
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
  });
  connection.start();
  expect(token).not.toHaveBeenCalled();
  expect(Socket.instances[0]?.protocols).toEqual(["quorem"]);
  connection.stop();
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

it("replaces a silent established socket even when its close handshake never finishes", async () => {
  const disconnected = vi.fn();
  const connection = createReconnectingSocket({
    url: () => "ws://localhost/events",
    timeout: 2000,
    idleTimeout: 25_000,
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: disconnected,
  });
  connection.start();
  await Promise.resolve();
  const silent = Socket.instances[0]!;
  silent.onopen?.();
  silent.close = vi.fn();
  await vi.advanceTimersByTimeAsync(20_000);
  silent.onmessage?.({ data: "heartbeat" } as MessageEvent);
  await vi.advanceTimersByTimeAsync(24_999);
  expect(disconnected).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(601);
  expect(disconnected).toHaveBeenCalledOnce();
  expect(Socket.instances).toHaveLength(2);
  connection.stop();
});

it("rotates before the authenticated bearer expires and reacquires a fresh token", async () => {
  vi.mocked(tokenExpiresAt).mockReturnValueOnce(Date.now() + 60_000);
  const { connection } = setup();
  connection.start();
  await Promise.resolve();
  Socket.instances[0]!.onopen?.();
  vi.mocked(token).mockResolvedValue("refreshed");
  await vi.advanceTimersByTimeAsync(30_600);
  expect(Socket.instances).toHaveLength(2);
  expect(Socket.instances[1]!.protocols).toContain("bearer.refreshed");
  connection.stop();
});

it("rotates using its own bearer expiry when another request refreshes during handshake", async () => {
  vi.mocked(tokenExpiresAt).mockReturnValue(Date.now() + 60_000);
  const { connection } = setup();
  connection.start();
  await Promise.resolve();
  vi.mocked(tokenExpiresAt).mockReturnValue(Date.now() + 300_000);
  Socket.instances[0]!.onopen?.();
  vi.mocked(token).mockResolvedValue("refreshed");
  await vi.advanceTimersByTimeAsync(30_001);
  expect(Socket.instances).toHaveLength(2);
  expect(Socket.instances[1]!.protocols).toContain("bearer.refreshed");
  connection.stop();
});
