/** @file matchState.test.ts @description Privacy and outcome display boundaries. @module matches */
import { describe, expect, it } from "vitest";
import { developmentUserIds, type MatchSnapshot } from "@quorem/contracts";
import { outcomeLabel, ownParticipant, remainingTime } from "./matchState";

const snapshot: MatchSnapshot = {
  id: "match",
  version: "3",
  state: "active",
  serverNow: "2026-10-10T12:00:00Z",
  difficulty: "easy",
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
