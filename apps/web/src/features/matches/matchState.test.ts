import { matchPreset } from "@quorem/contracts/match-rules";
/** @file matchState.test.ts @description Privacy and outcome display boundaries. @module matches */
import { describe, expect, it } from "vitest";
import { developmentUserIds, type MatchSnapshot } from "@quorem/contracts";
import {
  activeMatchReturnLabel,
  matchCompletionOutcome,
  outcomeLabel,
  ownParticipant,
  remainingTime,
} from "./matchState";

describe("active match return link", () => {
  it.each(["waiting", "ready", "active", "finalizing", "completed", "cancelled"] as const)(
    "uses current membership and %s state",
    (state) => {
      const match = { ...snapshot, state };
      const expected = state === "active" || state === "finalizing" ? "Return to match" : null;
      expect(activeMatchReturnLabel(match, "alice")).toBe(expected);
      expect(activeMatchReturnLabel({ ...match, participants: [] }, "alice")).toBeNull();
      expect(
        activeMatchReturnLabel(
          { ...match, participants: match.participants.map((p) => ({ ...p, forfeited: true })) },
          "alice",
        ),
      ).toBeNull();
    },
  );
});

const snapshot: MatchSnapshot = {
  id: "match",
  version: "3",
  state: "active",
  mode: "showdown",
  serverNow: "2026-10-10T12:00:00Z",
  difficulty: "easy",
  difficulties: ["easy"],
  rules: { ...matchPreset("casual"), clipboard: "off", focus: "off" },
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
    expect(outcomeLabel(terminal, "bob")).toBe("Victory");
    expect(
      outcomeLabel({ ...terminal, outcome: { ...terminal.outcome, kind: "draw" } }, "alice"),
    ).toBe("Draw");
    expect(
      outcomeLabel({ ...terminal, outcome: { ...terminal.outcome, kind: "no_contest" } }, "alice"),
    ).toBe("No contest");
    expect(outcomeLabel({ ...snapshot, state: "finalizing" }, "alice")).toBe("Finalizing results");
  });
});

describe("viewer-relative completion outcomes", () => {
  const settled: MatchSnapshot = {
    ...snapshot,
    state: "completed",
    outcome: {
      kind: "win",
      winnerUserId: developmentUserIds.alice,
      reason: "first_correct",
      completedAt: snapshot.serverNow,
    },
  };
  it("maps winners, losing participants and observers into the shared contract", () => {
    expect(matchCompletionOutcome(settled, "alice")).toBe("success");
    expect(matchCompletionOutcome(settled, "bob")).toBe("loss");
    expect(matchCompletionOutcome(settled, "charlie")).toBe("observer");
  });
  it.each(["draw", "no_contest", "cancelled"] as const)(
    "keeps %s neutral even with a stale winner field",
    (kind) => {
      expect(
        matchCompletionOutcome({ ...settled, outcome: { ...settled.outcome!, kind } }, "alice"),
      ).toBe("neutral");
    },
  );
  it("treats forfeiture as a loss and unsettled results as pending", () => {
    expect(
      matchCompletionOutcome(
        {
          ...settled,
          participants: settled.participants.map((player) => ({ ...player, forfeited: true })),
        },
        "alice",
      ),
    ).toBe("loss");
    expect(matchCompletionOutcome({ ...settled, state: "finalizing" }, "alice")).toBe("pending");
    expect(matchCompletionOutcome({ ...settled, state: "cancelled" }, "alice")).toBe("neutral");
  });
});
