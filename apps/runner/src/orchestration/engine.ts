/** @file engine.ts @description Connect checkpoint boundaries to the runner lease. @module runner */
import type { ExecutionRepository, ExecutionInputReader, Job } from "@quorem/execution";
import type { IsolatedSandbox } from "../sandbox/types.ts";
import { executeAndStage, ExecutionYield } from "../engine/execute.ts";
import type { AttemptEngine, AttemptOutcome } from "./attempt.ts";

/** Yield only between persisted cases; teardown and release remain the caller's responsibility. */
export function checkpointedEngine(
  repository: ExecutionRepository & ExecutionInputReader,
  sandbox: IsolatedSandbox,
  sliceMs = 50000,
): AttemptEngine {
  if (!Number.isSafeInteger(sliceMs) || sliceMs < 1 || sliceMs > 600000)
    throw new Error("Invalid execution slice");
  return {
    async execute(job: Job, signal: AbortSignal): Promise<AttemptOutcome> {
      const deadline = performance.now() + sliceMs;
      try {
        await executeAndStage(
          job,
          repository,
          sandbox,
          signal,
          () => performance.now() >= deadline,
        );
        return "complete";
      } catch (error) {
        if (error instanceof ExecutionYield) return "yield";
        throw error;
      }
    },
  };
}
