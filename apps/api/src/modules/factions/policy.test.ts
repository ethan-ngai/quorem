/** @file policy.test.ts @description Roster and voting boundary coverage. @module factions */
import { describe, expect, it } from "vitest";
import {
  balanceTeams,
  cancelVote,
  castVote,
  proposeVote,
  requireReadyTeams,
  resolveVote,
} from "./policy.ts";
const quote = {
  action: { kind: "concede" as const },
  ruleVersion: "1",
  cost: { seconds: 0, points: 0 },
};
describe("team organization", () => {
  it("balances with deterministic minimal moves", () => {
    expect(
      balanceTeams(
        [
          { userId: "a", team: 1 },
          { userId: "b", team: 1 },
          { userId: "c", team: 1 },
          { userId: "d", team: 2 },
        ],
        2,
      ),
    ).toEqual([
      { userId: "a", team: 1 },
      { userId: "b", team: 1 },
      { userId: "c", team: 2 },
      { userId: "d", team: 2 },
    ]);
  });
  it("allows uneven occupied teams but rejects unassigned players or one occupied team", () => {
    expect(() =>
      requireReadyTeams(
        [
          { userId: "a", team: 1 },
          { userId: "b", team: 1 },
          { userId: "c", team: 2 },
        ],
        2,
      ),
    ).not.toThrow();
    expect(() =>
      requireReadyTeams(
        [
          { userId: "a", team: 1 },
          { userId: "b", team: null },
        ],
        2,
      ),
    ).toThrow();
    expect(() =>
      requireReadyTeams(
        [
          { userId: "a", team: 1 },
          { userId: "b", team: 1 },
        ],
        2,
      ),
    ).toThrow();
  });
});
describe("team votes", () => {
  it("requires both players and never counts absent members as yes", () => {
    const vote = proposeVote("v", "a", ["a", "b"], quote, 0);
    expect(vote.state).toBe("pending");
    expect(resolveVote(vote, 29_999).state).toBe("pending");
    expect(castVote(vote, "b", true, 1).state).toBe("approved");
    expect(castVote(vote, "b", false, 1).state).toBe("rejected");
  });
  it("uses fixed majority and expires at the boundary", () => {
    const vote = proposeVote("v", "a", ["a", "b", "c"], quote, 0);
    expect(castVote(vote, "b", true, 29_999).state).toBe("approved");
    expect(castVote(vote, "b", true, 30_000).state).toBe("expired");
    expect(castVote(vote, "b", false, 1).state).toBe("pending");
  });
  it("rejects foreign voters, ballot changes and foreign cancellation", () => {
    const vote = proposeVote("v", "a", ["a", "b", "c", "d"], quote, 0);
    expect(() => castVote(vote, "x", true, 1)).toThrow();
    expect(() => castVote(vote, "a", false, 1)).toThrow();
    expect(() => cancelVote(vote, "b", 1)).toThrow();
    expect(cancelVote(vote, "a", 1).state).toBe("cancelled");
    expect(castVote(vote, "a", true, 1)).toEqual(vote);
  });
  it("single-member factions approve their own proposals", () => {
    expect(proposeVote("v", "a", ["a"], quote, 0).state).toBe("approved");
  });
});

it("keeps already-balanced small teams in their selected slots", () => {
  const members = [
    { userId: "a", team: 3 },
    { userId: "b", team: 4 },
  ];
  expect(balanceTeams(members, 4)).toEqual(members);
});
