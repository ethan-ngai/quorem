// @vitest-environment happy-dom
/** @file useMatchSync.test.tsx @description Covers match navigation and transport recovery. @module realtime */
import type { MatchSnapshot } from "@quorem/contracts";
import { matchPreset } from "@quorem/contracts/match-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { createReconnectingSocket } from "./reconnectingSocket";
import { useMatchSync } from "./useMatchSync";

const { get, connect } = vi.hoisted(() => ({ get: vi.fn(), connect: vi.fn() }));
vi.mock("../../api/client", async (original) => ({
  ...(await original<typeof import("../../api/client")>()),
  api: () => ({ GET: get }),
}));
vi.mock("./reconnectingSocket", () => ({ createReconnectingSocket: connect }));

const matchId = "11111111-1111-4111-8111-111111111111";

function response(version: string, state: MatchSnapshot["state"] = "active") {
  return {
    data: {
      id: matchId,
      version,
      state,
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
    } satisfies MatchSnapshot,
    response: { status: 200 },
  };
}

function sendSnapshot(socket: Parameters<typeof createReconnectingSocket>[0], data: MatchSnapshot) {
  socket.onMessage(
    new MessageEvent("message", {
      data: JSON.stringify({
        eventId: matchId,
        schemaVersion: 1,
        aggregateId: matchId,
        aggregateVersion: data.version,
        occurredAt: data.serverNow,
        type: data.state === "completed" ? "match.completed" : "match.updated",
        payload: data,
      }),
    }),
  );
}

let client: QueryClient;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const stop = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  get.mockReset();
  connect.mockReset().mockReturnValue({ start: vi.fn(), stop });
  stop.mockClear();
  client = new QueryClient();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderMatch() {
  function MatchState() {
    const { snapshot, status } = useMatchSync("alice", matchId);
    return <output>{[snapshot?.state, snapshot?.version, status].join(":")}</output>;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MatchState />
      </QueryClientProvider>,
    );
  });
  await advance();
}

function socketOptions(): Parameters<typeof createReconnectingSocket>[0] {
  return connect.mock.calls[0]?.[0];
}

it("loads the finished snapshot over HTTP without opening a socket", async () => {
  get.mockResolvedValue(response("1", "completed"));
  await renderMatch();
  expect(container.textContent).toBe("completed:1:connecting");
  expect(get).toHaveBeenCalledOnce();
  expect(connect).not.toHaveBeenCalled();
});

it("uses full socket snapshots to catch up without a second HTTP read", async () => {
  get.mockResolvedValue(response("1"));
  await renderMatch();
  const socket = socketOptions();
  await act(async () => socket.onOpen());
  expect(container.textContent).toBe("active:1:connecting");
  await act(async () => sendSnapshot(socket, { ...response("4").data, reviewPending: true }));
  await advance(3_000);
  expect(container.textContent).toBe("active:4:live");

  await act(async () => {
    sendSnapshot(socket, response("7", "completed").data);
    socket.onComplete?.();
  });
  await advance(3_000);
  expect(container.textContent).toBe("completed:7:live");
  expect(get).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
});

it("polls during a disconnect and stops when HTTP discovers completion", async () => {
  get.mockResolvedValueOnce(response("1")).mockResolvedValue(response("2", "completed"));
  await renderMatch();
  const socket = socketOptions();
  await act(async () => sendSnapshot(socket, response("1").data));
  await act(async () => socket.onDisconnect());
  expect(container.textContent).toBe("active:1:reconnecting");
  await advance(2_001);
  expect(container.textContent).toBe("completed:2:reconnecting");
  await advance(4_000);
  expect(get).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledOnce();
});

it("recovers when an open socket is silent and fences an older in-flight HTTP response", async () => {
  let resolvePoll!: (value: ReturnType<typeof response>) => void;
  get.mockResolvedValueOnce(response("1")).mockReturnValueOnce(
    new Promise<ReturnType<typeof response>>((resolve) => {
      resolvePoll = resolve;
    }),
  );
  await renderMatch();
  const socket = socketOptions();
  await act(async () => socket.onOpen());
  await advance(5_000);
  expect(container.textContent).toBe("active:1:reconnecting");
  await advance(2_000);
  expect(get).toHaveBeenCalledTimes(2);

  await act(async () => socket.onOpen());
  expect(container.textContent).toBe("active:1:reconnecting");
  await act(async () => sendSnapshot(socket, response("4", "finalizing").data));
  await act(async () => resolvePoll(response("2")));
  await advance(8_000);
  expect(container.textContent).toBe("finalizing:4:live");
  expect(get).toHaveBeenCalledTimes(2);
});

it("polls a completed match until review is ready, without a socket", async () => {
  const pending = response("1", "completed");
  get
    .mockResolvedValueOnce({ ...pending, data: { ...pending.data, reviewPending: true } })
    .mockResolvedValue(response("2", "completed"));
  await renderMatch();
  await advance(2_001);
  expect(container.textContent).toBe("completed:2:connecting");
  await advance(4_000);
  expect(get).toHaveBeenCalledTimes(2);
  expect(connect).not.toHaveBeenCalled();
});

it("stops polling and clears the visible snapshot when match access is denied", async () => {
  get.mockResolvedValueOnce(response("1")).mockResolvedValue({ response: { status: 403 } });
  await renderMatch();
  await act(async () => socketOptions().onDisconnect());
  await advance(2_001);
  expect(container.textContent).toBe("::reconnecting");
  await advance(4_000);
  expect(get).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledOnce();
});
