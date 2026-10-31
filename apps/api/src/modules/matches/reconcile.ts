/** @file reconcile.ts @description Ordered match progress and deadline decisions. @module matches */
import type { Reconciliation, SubmissionProgress } from "./model.ts";
/** Times are PostgreSQL epoch microseconds; submissions are in admission order. */
export function reconcile(
  now: bigint,
  deadline: bigint,
  finalizingAt: bigint | null,
  owners: readonly string[],
  submissions: readonly SubmissionProgress[],
): Reconciliation {
  const progress = new Map(owners.map((owner) => [owner, { state: "", bestPassed: 0 }]));
  let candidate = "",
    blocked = false;
  const earlierUncertain = new Set<string>();
  for (const submission of submissions) {
    const p = progress.get(submission.owner);
    if (!p) continue;
    p.state = submission.state;
    if (submission.state === "completed" && submission.score !== null) {
      p.bestPassed = Math.max(p.bestPassed, submission.score.passed);
      if (
        !submission.intermediate &&
        submission.verdict === "accepted" &&
        submission.score.passed === submission.score.total &&
        !candidate
      )
        candidate = submission.owner;
    } else {
      const failed =
        submission.cannotPass && submission.maxPossible !== null && submission.maxPossible >= 0;
      if (!candidate && !submission.intermediate && !failed) {
        earlierUncertain.add(submission.owner);
        blocked = true;
      }
    }
  }
  let winner = "",
    high = -1,
    draw = false;
  for (const [owner, p] of progress) {
    if (p.bestPassed > high) {
      winner = owner;
      high = p.bestPassed;
      draw = false;
    } else if (p.bestPassed === high) draw = true;
  }
  if (!candidate && now >= deadline) {
    blocked = false;
    for (const submission of submissions) {
      if (
        !progress.has(submission.owner) ||
        (submission.state === "completed" && submission.score !== null)
      )
        continue;
      if (!draw && submission.owner === winner) continue;
      const failed =
        submission.cannotPass && submission.maxPossible !== null && submission.maxPossible >= 0;
      if (!submission.intermediate && !failed) {
        blocked = true;
        continue;
      }
      if (
        !failed ||
        (draw && submission.maxPossible! > high) ||
        (!draw && submission.maxPossible! >= high)
      )
        blocked = true;
    }
  }
  if (candidate) blocked = [...earlierUncertain].some((owner) => owner !== candidate);
  let outcome: Reconciliation["outcome"] = null;
  if (candidate && !blocked)
    outcome = { kind: "win", winnerUserId: candidate, reason: "first_correct" };
  else if (now >= deadline || candidate || finalizingAt !== null) {
    if (finalizingAt === null) finalizingAt = now >= deadline ? deadline : now;
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
