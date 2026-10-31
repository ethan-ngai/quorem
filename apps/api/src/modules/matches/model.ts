/** @file model.ts @description Provider-free match reconciliation values. @module matches */
export interface Progress {
  state: string;
  bestPassed: number;
}
export interface SubmissionProgress {
  owner: string;
  state: string;
  verdict: string;
  score: { passed: number; total: number } | null;
  intermediate: boolean;
  maxPossible: number | null;
  cannotPass: boolean;
}
export interface Outcome {
  kind: "win" | "draw" | "no_contest";
  winnerUserId?: string;
  reason: "first_correct" | "deadline_score" | "unresolved_eligible_work";
}
export interface Reconciliation {
  progress: Map<string, Progress>;
  finalizingAt: bigint | null;
  outcome: Outcome | null;
}
