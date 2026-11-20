// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../auth/session", () => ({ authenticatedFetch: fetchMock }));
import { usePlatformPresence } from "./party";

function Subject({ partyId }: { partyId?: string }) {
  usePlatformPresence("alice", partyId);
  return null;
}

it("does not replace newer party state with a delayed heartbeat", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  const client = new QueryClient();
  const key = ["current-party", "alice"];
  client.setQueryData(key, { party: { id: "p", version: "1" } });
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Subject partyId="p" />
      </QueryClientProvider>,
    ),
  );
  const newer = { party: { id: "p", version: "2" } };
  client.setQueryData(key, newer);
  await act(async () => {
    resolve(new Response(JSON.stringify({ party: null }), { status: 200 }));
    await Promise.resolve();
  });
  expect(client.getQueryData(key)).toEqual(newer);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("renews presence only between joining and leaving a lobby", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fetchMock.mockClear();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ party: { id: "p", version: "1" } }), { status: 200 }),
    ),
  );
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  const render = (partyId?: string) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Subject partyId={partyId} />
        </QueryClientProvider>,
      ),
    );
  try {
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(fetchMock).not.toHaveBeenCalled();
    await render("p");
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    fetchMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
