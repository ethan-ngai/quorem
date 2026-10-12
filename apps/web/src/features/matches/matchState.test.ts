/** @file matchState.test.ts @description Privacy and outcome display boundaries. @module matches */
import { describe, expect, it } from "vitest";
import { developmentUserIds, type MatchSnapshot } from "@quorem/contracts";
import { lobbyWaitingLabel, outcomeLabel, ownParticipant, remainingTime } from "./matchState";

describe("lobby readiness", () => {
  it("waits for every FFA participant and then an explicit host start", () => {
    const ffa = {
      ...snapshot,
      mode: "free-for-all" as const,
      participants: [
        ...snapshot.participants,
        {
          userId: developmentUserIds.charlie,
          displayName: "Charlie",
          ready: false,
          presence: "online" as const,
        },
      ],
    };
    expect(lobbyWaitingLabel(ffa, "alice")).toBe("Waiting for players to ready");
    expect(
      lobbyWaitingLabel(
        { ...ffa, participants: ffa.participants.map((player) => ({ ...player, ready: true })) },
        "alice",
      ),
    ).toBe("Waiting for host to start");
  });
  it("keeps join status even when the only player is ready", () => {
    for (const ready of [false, true]) {
      const solo = { ...snapshot, participants: [{ ...snapshot.participants[1]!, ready }] };
      expect(lobbyWaitingLabel(solo, "alice")).toBe("Waiting for opponent to join");
    }
  });
  it("names the participant still needing to ready", () => {
    for (const ownReady of [false, true]) {
      for (const opponentReady of [false, true]) {
        const pair = {
          ...snapshot,
          participants: [
            { ...snapshot.participants[0]!, ready: opponentReady },
            { ...snapshot.participants[1]!, ready: ownReady },
          ],
        };
        expect(lobbyWaitingLabel(pair, "alice")).toBe(
          !opponentReady
            ? "Waiting for opponent to ready"
            : !ownReady
              ? "Waiting for you to ready"
              : "Starting Showdown…",
        );
      }
    }
  });
});

const snapshot: MatchSnapshot = {
  id: "match",
  version: "3",
  state: "active",
  mode: "showdown",
  serverNow: "2026-10-10T12:00:00Z",
  difficulty: "easy",
  difficulties: ["easy"],
  rules: { clipboard: "off", focus: "off" },
  ruleEvents: [],
  durationMinutes: 15,
  hostUserId: developmentUserIds.alice,
  expiresAt: "2026-10-10T13:00:00Z",
  participants: [
    {
      userId: developmentUserIds.bob,
      displayName: "Bob",
      ready: true,
      presence: "online",
      workspaceId: "bob-private",
    },
    {
      userId: developmentUserIds.alice,
      displayName: "Alice",
      ready: true,
      presence: "online",
      workspaceId: "alice-private",
    },
  ],
};
describe("match presentation boundaries", () => {
  it("selects the owner's workspace even when opponent is first", () => {
    expect(ownParticipant(snapshot, "alice")?.workspaceId).toBe("alice-private");
    expect(
      ownParticipant({ ...snapshot, participants: snapshot.participants.slice(0, 1) }, "alice"),
    ).toBeUndefined();
  });
  it("counts from server time and clamps an expired deadline", () => {
    expect(remainingTime("2026-10-10T12:15:00Z", snapshot.serverNow, 2100)).toBe("14:58");
    expect(remainingTime("2026-10-10T11:59:00Z", snapshot.serverNow)).toBe("00:00");
  });
  it("distinguishes draw, no contest, finalizing, and relative winner", () => {
    const terminal = {
      ...snapshot,
      state: "completed" as const,
      outcome: {
        kind: "win" as const,
        winnerUserId: developmentUserIds.bob,
        reason: "score",
        completedAt: snapshot.serverNow,
      },
    };
    expect(outcomeLabel(terminal, "alice")).toBe("Opponent won");
    expect(outcomeLabel(terminal, "bob")).toBe("You won");
    expect(
      outcomeLabel({ ...terminal, outcome: { ...terminal.outcome, kind: "draw" } }, "alice"),
    ).toBe("Draw");
    expect(
      outcomeLabel({ ...terminal, outcome: { ...terminal.outcome, kind: "no_contest" } }, "alice"),
    ).toBe("No contest");
    expect(outcomeLabel({ ...snapshot, state: "finalizing" }, "alice")).toBe("Finalizing results");
  });
});
