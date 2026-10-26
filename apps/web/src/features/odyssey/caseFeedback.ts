/** @file caseFeedback.ts @description Stage verdicts derive from evaluated public cases, never unlock position. @module odyssey */
import type { OdysseyProgress, Submission } from "@quorem/contracts";

/** A newer completed execution overrides historical statuses; pending jobs preserve prior evidence. */
export function passedCaseLevels(progress: OdysseyProgress, submission?: Submission): number[] {
  const statuses = new Map(progress.caseStatuses?.map((result) => [result.index, result.status]));
  if (submission?.state === "completed") {
    for (const result of submission.publicCases ?? []) statuses.set(result.index, result.status);
  }
  let offset = 0;
  return progress.levels.flatMap((level, index) => {
    const passed =
      level.examples.length > 0 &&
      level.examples.every((_, caseIndex) => statuses.get(offset + caseIndex) === "accepted");
    offset += level.examples.length;
    return passed ? [index + 1] : [];
  });
}
