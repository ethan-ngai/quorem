import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInterviewSocket } from "./socket";
import { token } from "../auth/session";
vi.mock("../auth/session", () => ({ token: vi.fn(async () => "signed-token") }));
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (message: { data: string }) => void;
  onerror?: () => void;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    Socket.instances.push(this);
  }
  send(body: string) {
    this.sent.push(body);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", { location: { origin: "http://localhost:5180" } });
  vi.mocked(token).mockResolvedValue("signed-token");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("interview socket", () => {
  it("authenticates, correlates replies and remains idle without recurring requests", async () => {
    const transport = createInterviewSocket("room");
    const changed = vi.fn();
    transport.onChange(changed);
    transport.start();
    await Promise.resolve();
    const socket = Socket.instances[0]!;
    socket.open();
    expect(String(socket.url)).toBe("ws://localhost:5180/v1/interviews/room/events");
    expect(socket.protocols).toEqual(["quorem", "bearer.signed-token"]);
    const response = transport.request("pull", { version: 0 });
    const request = JSON.parse(socket.sent[0]!);
    socket.frame({ type: "response", id: request.id, value: { version: 1 } });
    await expect(response).resolves.toEqual({ version: 1 });
    socket.frame({ type: "changed", kind: "interview.document" });
    expect(changed).toHaveBeenLastCalledWith("interview.document");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.sent).toHaveLength(1);
    transport.stop();
  });
  it("rejects in-flight commands on disconnect and reconnects", async () => {
    const transport = createInterviewSocket("room");
    transport.start();
    await Promise.resolve();
    const socket = Socket.instances[0]!;
    socket.open();
    const response = transport.request("push", { key: "same-retry-key" });
    const rejected = expect(response).rejects.toThrow("disconnected");
    socket.close();
    await rejected;
    await vi.advanceTimersByTimeAsync(500);
    expect(Socket.instances).toHaveLength(2);
    transport.stop();
  });
  it("fences an old token lookup across stop/start", async () => {
    let finish!: (value: string) => void;
    vi.mocked(token).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const transport = createInterviewSocket("room");
    transport.start();
    transport.stop();
    transport.start();
    await Promise.resolve();
    finish("old-token");
    await Promise.resolve();
    expect(Socket.instances).toHaveLength(1);
    expect(Socket.instances[0]!.protocols).toContain("bearer.signed-token");
    transport.stop();
  });
});
