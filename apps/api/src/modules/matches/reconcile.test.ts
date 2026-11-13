/** @file reconcile.test.ts @description Golden match decisions mirrored from Go. @module matches */
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile.ts";
import type { SubmissionProgress } from "./model.ts";
const now = 1_767_268_800_000_000n,
  minute = 60_000_000n;
const entry = (
  owner: string,
  state: string,
  extra: Partial<SubmissionProgress> = {},
): SubmissionProgress => ({
  owner,
  admittedAt: now - minute,
  state,
  verdict: "",
  score: null,
  intermediate: false,
  maxPossible: null,
  cannotPass: false,
  ...extra,
});
const accepted = (owner: string) =>
  entry(owner, "completed", { verdict: "accepted", score: { passed: 4, total: 4 } });
const partial = (owner: string, n: number) =>
  entry(owner, "completed", { verdict: "wrong_answer", score: { passed: n, total: 4 } });
describe("Go match reconciliation vectors", () => {
  it.each([
    ["first admitted wins", [accepted("bob"), accepted("alice")], "bob"],
    ["same owner earlier uncertainty", [entry("bob", "running"), accepted("bob")], "bob"],
    ["later opponent cannot overturn", [accepted("bob"), entry("alice", "running")], "bob"],
    ["forfeited actor ignored", [accepted("carol"), accepted("alice")], "alice"],
  ])("%s", (_name, submissions, winner) => {
    expect(
      reconcile(
        now,
        now + minute,
        null,
        ["alice", "bob"],
        (submissions as SubmissionProgress[]).map((submission, index) => ({
          ...submission,
          admittedAt: now - minute + BigInt(index),
        })),
      ).outcome,
    ).toEqual({ kind: "win", winnerUserId: winner, reason: "first_correct" });
  });
  it("blocks an earlier opponent and uses the persisted finalization boundary", () => {
    const rows = [entry("alice", "running"), accepted("bob")];
    const start = reconcile(now, now + minute, null, ["alice", "bob"], rows);
    expect(start.outcome).toBeNull();
    expect(start.finalizingAt).toBe(now);
    expect(
      reconcile(now + 120_000_000n - 1n, now + minute * 5n, now, ["alice", "bob"], rows).outcome,
    ).toBeNull();
    expect(
      reconcile(now + 120_000_000n, now + minute * 5n, now, ["alice", "bob"], rows).outcome,
    ).toEqual({ kind: "no_contest", reason: "unresolved_eligible_work" });
  });
  it("preserves best scores and checkpoint certainty at the deadline", () => {
    const failed = entry("bob", "running", { cannotPass: true, maxPossible: 2 });
    expect(
      reconcile(
        now,
        now,
        null,
        ["alice", "bob"],
        [partial("alice", 3), partial("alice", 1), failed],
      ).outcome,
    ).toEqual({ kind: "win", winnerUserId: "alice", reason: "deadline_score" });
    expect(
      reconcile(
        now,
        now,
        null,
        ["alice", "bob"],
        [partial("alice", 3), { ...failed, maxPossible: 3 }],
      ).outcome,
    ).toBeNull();
    expect(
      reconcile(
        now,
        now,
        null,
        ["alice", "bob"],
        [partial("alice", 3), partial("bob", 3), { ...failed, maxPossible: 3 }],
      ).outcome,
    ).toEqual({ kind: "draw", reason: "deadline_score" });
  });
  it("does not treat intermediate Odyssey success as a first-correct win", () => {
    const stage = { ...accepted("alice"), intermediate: true };
    const result = reconcile(now, now + minute, null, ["alice", "bob"], [stage]);
    expect(result.outcome).toBeNull();
    expect(result.progress.get("alice")?.bestPassed).toBe(4);
  });
});

describe("penalty victory rules", () => {
  const players = ["alice", "bob"];
  it("uses the original admission order even after personal submission time ends", () => {
    const deadline = now + minute;
    const rules = { victory: "race" as const, penalties: new Map(), submissionDeadline: now };
    const winner = { ...accepted("bob"), admittedAt: now - minute / 2n };
    const later = { ...accepted("alice"), admittedAt: now - 1n };
    for (const time of [now - 1n, now])
      expect(reconcile(time, deadline, null, players, [later, winner], rules).outcome).toEqual({
        kind: "win",
        winnerUserId: "bob",
        reason: "first_correct",
      });
    const pending = entry("alice", "running", { admittedAt: now - minute });
    const unresolved = reconcile(now, deadline, null, players, [pending, winner], rules);
    expect(unresolved.outcome).toBeNull();
    expect(unresolved.finalizingAt).toBe(now);
  });
  it("does not let an over-deadline perfect submission win through score fallback", () => {
    const rows = [
      { ...partial("alice", 1), admittedAt: now - minute },
      { ...accepted("alice"), admittedAt: now + 1n },
      { ...partial("bob", 2), admittedAt: now - minute },
    ];
    expect(reconcile(now, now, null, players, rows).outcome).toEqual({
      kind: "win",
      winnerUserId: "bob",
      reason: "deadline_score",
    });
  });
  it("draws genuinely simultaneous correct finishes", () => {
    expect(
      reconcile(
        now,
        now + minute,
        null,
        players,
        players.map((p) => ({ ...accepted(p), admittedAt: now })),
      ).outcome?.kind,
    ).toBe("draw");
  });
  it("waits for an earlier eligible unresolved rival", () => {
    const rows = [
      { ...entry("bob", "running"), admittedAt: now - 1n },
      { ...accepted("alice"), admittedAt: now },
    ];
    expect(reconcile(now, now + minute, null, players, rows).outcome).toBeNull();
  });
  it("does not turn unresolved persisted finalization into a draw", () => {
    const rows = [{ ...entry("bob", "running"), admittedAt: now - minute }];
    expect(reconcile(now, now + minute, now - 2n * minute, players, rows).outcome).toEqual({
      kind: "no_contest",
      reason: "unresolved_eligible_work",
    });
  });
  it("High Score runs until deadline and subtracts points from the best score", () => {
    const rules = { victory: "high_score" as const, penalties: new Map([["alice", 30]]) };
    const rows = [accepted("alice"), partial("bob", 3), partial("bob", 1)];
    expect(reconcile(now, now + minute, null, players, rows, rules).outcome).toBeNull();
    expect(reconcile(now, now, null, players, rows, rules).outcome?.winnerUserId).toBe("bob");
  });
  it("retains negative scores and excludes infrastructure failures from unresolved work", () => {
    const rules = {
      victory: "high_score" as const,
      penalties: new Map([
        ["alice", 10],
        ["bob", 20],
      ]),
    };
    expect(
      reconcile(now, now, null, players, [entry("bob", "failed")], rules).outcome?.winnerUserId,
    ).toBe("alice");
  });
});
