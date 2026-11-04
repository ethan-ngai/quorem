/** @file submissionStream.test.ts @description Authenticated SSE reconnect and cancellation. @module editor */
import { authenticatedFetch } from "../auth/session";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { submissionStream } from "./submissionStream";

vi.mock("../auth/session", () => ({ authenticatedFetch: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { origin: "https://quorem.test" } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("reads split frames, ignores heartbeats, and recovers on reconnect", async () => {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  vi.mocked(authenticatedFetch).mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controllers.push(controller);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const changed = vi.fn();
  const disconnected = vi.fn();
  const stream = submissionStream("result", changed, disconnected);
  const encoder = new TextEncoder();
  try {
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    const [url, options] = vi.mocked(authenticatedFetch).mock.calls[0]!;
    expect(url).toEqual(new URL("https://quorem.test/v1/submissions/result/events"));
    expect(options?.headers).toEqual({ Accept: "text/event-stream" });
    controllers[0]!.enqueue(encoder.encode(": heartbeat\n\nevent: chan"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).not.toHaveBeenCalled();
    controllers[0]!.enqueue(encoder.encode("ged\ndata: {}\n\n"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledOnce();
    controllers[0]!.close();
    await vi.advanceTimersByTimeAsync(600);
    expect(disconnected).toHaveBeenCalledOnce();
    controllers[1]!.enqueue(encoder.encode("event: changed\ndata: {}\n\n"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledTimes(2);
    stream.stop();
    expect(vi.mocked(authenticatedFetch).mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  } finally {
    stream.stop();
    controllers[1]?.close();
  }
});
