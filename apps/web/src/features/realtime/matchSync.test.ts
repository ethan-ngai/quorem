/** @file matchSync.test.ts @description Regression coverage for match event guards and ordering. @module realtime */
import type { EventEnvelope, MatchSnapshot } from "@quorem/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  bufferMatchEvent,
  createReconnectScheduler,
  isMatchSnapshot,
  keepNewestSnapshot,
  mergeMatchEvents,
  MAX_BUFFERED_MATCH_EVENTS,
  parseMatchEvent,
} from "./matchSync";

const matchId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function snapshot(version: string, state: MatchSnapshot["state"] = "active"): MatchSnapshot {
  return {
    id: matchId,
    version,
    state,
    serverNow: "2026-10-10T12:00:00Z",
    difficulty: "easy",
    durationMinutes: 15,
    participants: [{ userId, displayName: "Alice", ready: true, presence: "online" }],
    hostUserId: userId,
    expiresAt: "2026-10-11T12:00:00Z",
  };
}

function event(version: string, state: MatchSnapshot["state"] = "active"): EventEnvelope {
  return {
    eventId: `${version.padStart(8, "0")}-1111-4111-8111-111111111111`,
    schemaVersion: 1,
    aggregateId: matchId,
    aggregateVersion: version,
    type: state === "completed" ? "match.completed" : "match.updated",
    occurredAt: "2026-10-10T12:00:00Z",
    payload: snapshot(version, state),
  };
}

describe("match sync guards and ordering", () => {
  it("rejects snapshots and events with mismatched ids or versions", () => {
    expect(isMatchSnapshot(snapshot("1"), matchId)).toBe(true);
    expect(isMatchSnapshot(snapshot("01"), matchId)).toBe(false);
    expect(parseMatchEvent(event("2"), matchId)).toBeDefined();
    expect(parseMatchEvent({ ...event("2"), aggregateId: userId }, matchId)).toBeUndefined();
    expect(parseMatchEvent({ ...event("2"), aggregateVersion: "3" }, matchId)).toBeUndefined();
  });

  it("applies buffered updates by BigInt version and ignores duplicates or older snapshots", () => {
    const initial = snapshot("9007199254740992");
    const next = event("9007199254740993");
    const latest = event("9007199254740994", "completed");
    const merged = mergeMatchEvents(initial, [latest, next, next]);

    expect(merged.snapshot.version).toBe("9007199254740994");
    expect(merged.snapshot.state).toBe("completed");
    expect(merged.gap).toBe(false);
    expect(keepNewestSnapshot(merged.snapshot, initial)).toBe(merged.snapshot);
  });

  it("requests recovery when an aggregate version is skipped", () => {
    expect(mergeMatchEvents(snapshot("3"), [event("5")])).toMatchObject({
      snapshot: { version: "3" },
      gap: true,
    });
  });

  it("rejects malformed optional fields, duplicate seats, and invalid seat counts", () => {
    const valid = snapshot("4");
    expect(isMatchSnapshot({ ...valid, startedAt: "yesterday" }, matchId)).toBe(false);
    expect(isMatchSnapshot({ ...valid, problemVersionId: "not-a-uuid" }, matchId)).toBe(false);
    expect(
      isMatchSnapshot(
        {
          ...valid,
          outcome: { kind: "win", reason: "done", completedAt: valid.serverNow },
        },
        matchId,
      ),
    ).toBe(true);
    expect(
      isMatchSnapshot(
        {
          ...valid,
          outcome: { kind: "unknown", reason: "done", completedAt: valid.serverNow },
        },
        matchId,
      ),
    ).toBe(false);
    expect(
      isMatchSnapshot(
        {
          ...valid,
          participants: [{ ...valid.participants[0]!, bestScore: { passed: 3, total: 2 } }],
        },
        matchId,
      ),
    ).toBe(false);
    expect(
      isMatchSnapshot(
        {
          ...valid,
          participants: [valid.participants[0], valid.participants[0]],
        },
        matchId,
      ),
    ).toBe(false);
    expect(
      isMatchSnapshot(
        {
          ...valid,
          participants: [valid.participants[0], valid.participants[0], valid.participants[0]],
        },
        matchId,
      ),
    ).toBe(false);
  });

  it("keeps equal-version snapshots when their server time is older", () => {
    const fresh: MatchSnapshot = {
      ...snapshot("7"),
      serverNow: "2026-10-10T12:00:05Z",
      participants: [{ userId, displayName: "Alice", ready: true, presence: "online" }],
    };
    const stale: MatchSnapshot = {
      ...snapshot("7"),
      serverNow: "2026-10-10T12:00:04Z",
      participants: [{ userId, displayName: "Alice", ready: true, presence: "offline" }],
    };
    expect(keepNewestSnapshot(fresh, stale)).toBe(fresh);
    expect(
      keepNewestSnapshot(fresh, { ...stale, serverNow: "2026-10-10T12:00:06Z" }),
    ).toMatchObject({
      participants: [{ presence: "offline" }],
    });
  });

  it("caps buffered events and marks overflow for snapshot recovery", () => {
    const buffer = { events: [] as EventEnvelope[], overflow: false };
    for (let index = 1; index <= MAX_BUFFERED_MATCH_EVENTS + 1; index += 1) {
      bufferMatchEvent(buffer, event(String(index)));
    }
    expect(buffer.events).toHaveLength(0);
    expect(buffer.overflow).toBe(true);
    bufferMatchEvent(buffer, event("99"));
    expect(buffer.events).toHaveLength(0);
  });
});

describe("match reconnect lifecycle", () => {
  it("bounds retry delay, resets after connection, and cancels pending reconnect on cleanup", () => {
    const connect = vi.fn();
    const schedule = vi.fn((_callback: () => void, _delay: number) => 1);
    const cancel = vi.fn();
    const reconnect = createReconnectScheduler(connect, schedule, cancel, () => 1);

    reconnect.schedule();
    expect(schedule.mock.calls[0]?.[1]).toBe(600);
    reconnect.schedule();
    expect(schedule).toHaveBeenCalledTimes(1);
    schedule.mock.calls[0]?.[0]();
    reconnect.reset();
    reconnect.schedule();
    expect(schedule.mock.calls[1]?.[1]).toBe(600);
    reconnect.stop();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it("keeps jittered reconnect delays at or below ten seconds", () => {
    const connect = vi.fn();
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const reconnect = createReconnectScheduler(
      connect,
      (callback, delay) => {
        callbacks.push(callback);
        delays.push(delay);
        return callbacks.length;
      },
      vi.fn(),
      () => 1,
    );

    for (let attempt = 0; attempt < 9; attempt += 1) {
      reconnect.schedule();
      callbacks.shift()?.();
    }
    expect(Math.max(...delays)).toBe(10_000);
    expect(delays.every((delay) => delay <= 10_000)).toBe(true);
  });
});
