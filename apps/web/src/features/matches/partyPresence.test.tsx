// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../auth/session", () => ({ authenticatedFetch: fetchMock }));
import { usePlatformPresence } from "./party";

function Subject() {
  usePlatformPresence("alice", true);
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
        <Subject />
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
