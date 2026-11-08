// @vitest-environment happy-dom
/** @file useMatchSync.test.tsx @description Covers cold navigation to a completed match. @module realtime */
import { matchPreset } from "@quorem/contracts/match-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useMatchSync } from "./useMatchSync";

const { get, connect } = vi.hoisted(() => ({ get: vi.fn(), connect: vi.fn() }));
vi.mock("../../api/client", async (original) => ({
  ...(await original<typeof import("../../api/client")>()),
  api: () => ({ GET: get }),
}));
vi.mock("./reconnectingSocket", () => ({ createReconnectingSocket: connect }));

it("loads the finished snapshot over HTTP without opening a socket", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const matchId = "11111111-1111-4111-8111-111111111111";
  get.mockResolvedValue({
    data: {
      id: matchId,
      version: "1",
      state: "completed",
      mode: "showdown",
      difficulty: "easy",
      difficulties: ["easy"],
      rules: matchPreset("casual"),
      ruleEvents: [],
      participants: [],
      hostUserId: matchId,
      durationMinutes: 15,
      serverNow: "2026-11-07T12:00:00Z",
      expiresAt: "2026-11-08T12:00:00Z",
    },
    response: { status: 200 },
  });
  function MatchState() {
    const { snapshot, error } = useMatchSync("alice", matchId);
    return <output>{error?.message ?? snapshot?.state ?? "loading"}</output>;
  }
  const client = new QueryClient();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MatchState />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe("completed");
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});
