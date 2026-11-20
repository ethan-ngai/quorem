// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

const { fetchMock, socketMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), socketMock: vi.fn() }));
vi.mock("../auth/session", () => ({ authenticatedFetch: fetchMock }));
vi.mock("../realtime/reconnectingSocket", () => ({ createReconnectingSocket: socketMock }));
import { useLiveParty } from "./party";

function Subject() {
  useLiveParty("alice", true);
  return null;
}

it("uses lobby snapshots, ignores stale frames, and stops polling when live", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const client = new QueryClient();
  const key = ["current-party", "alice"];
  const root = createRoot(document.createElement("div"));
  const stop = vi.fn();
  let message!: (event: MessageEvent) => void;
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ party: null })));
  socketMock.mockImplementation(({ onMessage }) => {
    message = onMessage;
    return { start: vi.fn(), stop };
  });
  const frame = (version: string) =>
    new MessageEvent("message", {
      data: JSON.stringify({ type: "party.snapshot", party: { id: "p", version } }),
    });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Subject />
        </QueryClientProvider>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(socketMock).not.toHaveBeenCalled();
    await act(async () => client.setQueryData(key, { party: { id: "p", version: "1" } }));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(socketMock).toHaveBeenCalledOnce();
    await act(async () => message(frame("2")));
    await act(async () => message(frame("1")));
    expect(client.getQueryData(key)).toEqual({ party: { id: "p", version: "2" } });
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => client.setQueryData(key, { party: null }));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(stop).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
