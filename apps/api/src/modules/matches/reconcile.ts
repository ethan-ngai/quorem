/** @file reconcile.ts @description Penalty-adjusted race and full-duration score decisions. @module matches */
import type { Reconciliation, SubmissionProgress } from "./model.ts";

/** Times are server epoch microseconds; equal eligible finish times remain tied. */
export function reconcile(
  now: bigint,
  deadline: bigint,
  finalizingAt: bigint | null,
  owners: readonly string[],
  submissions: readonly SubmissionProgress[],
  rules: { victory: "race" | "high_score"; penalties: ReadonlyMap<string, number> } = {
    victory: "race",
    penalties: new Map(),
  },
): Reconciliation {
  const progress = new Map(
    owners.map((owner) => [
      owner,
      { state: "", bestPassed: 0, bestPercentage: 0, eligibleFinishAt: null as bigint | null },
    ]),
  );
  const percentages = new Map(owners.map((owner) => [owner, 0]));
  const eligible = submissions.filter(
    (s) => progress.has(s.owner) && (s.eligibleAt ?? 0n) <= deadline,
  );
  for (const s of eligible) {
    const p = progress.get(s.owner)!;
    p.state = s.state;
    if (
      s.state === "completed" &&
      !s.intermediate &&
      s.verdict === "accepted" &&
      s.score &&
      s.score.passed === s.score.total
    ) {
      const time = s.eligibleAt ?? BigInt(submissions.indexOf(s));
      if (p.eligibleFinishAt === null || time < p.eligibleFinishAt) p.eligibleFinishAt = time;
    }
  }
  const due = eligible.filter((s) => (s.eligibleAt ?? 0n) <= now);
  let candidateTime: bigint | null = null;
  const candidates = new Set<string>();
  for (const s of due) {
    const p = progress.get(s.owner)!;
    p.state = s.state;
    if (s.state !== "completed" || s.score === null) continue;
    p.bestPassed = Math.max(p.bestPassed, s.score.passed);
    p.bestPercentage = Math.max(
      p.bestPercentage,
      s.score.total ? (100 * s.score.passed) / s.score.total : 0,
    );
    percentages.set(s.owner, p.bestPercentage);
    if (
      rules.victory !== "race" ||
      s.intermediate ||
      s.verdict !== "accepted" ||
      s.score.passed !== s.score.total
    )
      continue;
    const time = s.eligibleAt ?? BigInt(submissions.indexOf(s));
    if (candidateTime === null || time < candidateTime) {
      candidateTime = time;
      candidates.clear();
    }
    if (time === candidateTime) candidates.add(s.owner);
  }
  let winner = "",
    high = -Infinity,
    draw = false;
  for (const [owner, p] of progress) {
    const score =
      rules.victory === "high_score"
        ? percentages.get(owner)! - (rules.penalties.get(owner) ?? 0)
        : p.bestPassed;
    if (score > high) {
      winner = owner;
      high = score;
      draw = false;
    } else if (score === high) draw = true;
  }
  let blocked = false;
  for (const s of due) {
    if (
      s.state === "failed" ||
      s.state === "cancelled" ||
      (s.state === "completed" && s.score !== null)
    )
      continue;
    const cannotPass = s.cannotPass && s.maxPossible !== null && s.maxPossible >= 0;
    if (candidateTime !== null) {
      const time = s.eligibleAt ?? BigInt(submissions.indexOf(s));
      if (time <= candidateTime && !s.intermediate && !cannotPass && !candidates.has(s.owner))
        blocked = true;
    } else if (now >= deadline) {
      if (!draw && s.owner === winner) continue;
      const upper =
        rules.victory === "high_score" ? 100 - (rules.penalties.get(s.owner) ?? 0) : s.maxPossible;
      if (!cannotPass || upper === null || (draw ? upper > high : upper >= high)) blocked = true;
    }
  }
  let outcome: Reconciliation["outcome"] = null;
  if (candidateTime !== null && !blocked) {
    outcome =
      candidates.size === 1
        ? { kind: "win", winnerUserId: [...candidates][0], reason: "first_correct" }
        : { kind: "draw", reason: "first_correct" };
  } else if (now >= deadline || candidateTime !== null || finalizingAt !== null) {
    finalizingAt ??= now >= deadline ? deadline : now;
    if (blocked) {
      if (now >= finalizingAt + 120_000_000n)
        outcome = { kind: "no_contest", reason: "unresolved_eligible_work" };
    } else
      outcome = draw
        ? { kind: "draw", reason: "deadline_score" }
        : { kind: "win", ...(winner ? { winnerUserId: winner } : {}), reason: "deadline_score" };
  }
  return { progress, finalizingAt, outcome };
}
