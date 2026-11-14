// @vitest-environment happy-dom
/** @file useActiveMatch.test.tsx @description Covers membership checks during lobby handoff. @module matches */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { developmentUserIds, type MatchSnapshot } from "@quorem/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { currentMatchQueryKey, usePartyRoundNavigation } from "./useActiveMatch";

const { getMatch, navigate } = vi.hoisted(() => ({ getMatch: vi.fn(), navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../api/client", () => ({
  api: () => ({ GET: getMatch }),
  requireData: (data: unknown) => data,
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function Lobby({ roundId }: { roundId?: string }) {
  return usePartyRoundNavigation("alice", roundId) ? <p>Waiting for next round</p> : null;
}

it.each([true, false])("waits for new round membership (playing: %s)", async (playing) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient();
  client.setQueryData(currentMatchQueryKey("alice"), null);
  const container = document.createElement("div");
  const root = createRoot(container);
  let resolveMatch!: (value: { data: MatchSnapshot | null }) => void;
  getMatch.mockReturnValue(
    new Promise((resolve) => {
      resolveMatch = resolve;
    }),
  );

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Lobby />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Lobby roundId="round" />
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).toBe("");
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveMatch({
        data: playing
          ? ({
              id: "round",
              state: "active",
              participants: [{ userId: developmentUserIds.alice }],
            } as MatchSnapshot)
          : null,
      });
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(client.getQueryState(currentMatchQueryKey("alice", "round"))?.status).toBe(
          "success",
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe(playing ? "" : "Waiting for next round");
    if (playing) {
      expect(navigate).toHaveBeenCalledWith({ to: "/match/$id", params: { id: "round" } });
    } else {
      expect(navigate).not.toHaveBeenCalled();
    }
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
