/** @file completionOutcome.ts @description Viewer-relative celebration policy shared by every mode. @module ui */
export type CompletionOutcome = "success" | "loss" | "observer" | "pending" | "neutral" | "draw";

/** Observers may celebrate another person's success; losing participants never do. */
export function canCelebrate(outcome: CompletionOutcome) {
  return outcome === "success" || outcome === "observer";
}
