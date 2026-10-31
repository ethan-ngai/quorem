import type { ConnectionScope } from "@quorem/database/core";
import type { ExecutionQueueControl, ExecutionRepository } from "@quorem/execution";
import { postgresClaims, type RunnerCapabilities } from "./claim.ts";
import { postgresCompletionStaging } from "./staging.ts";
import { postgresCompletionPromotion } from "./promote.ts";
import { postgresCheckpoints } from "./checkpoints.ts";
import { postgresExecutionLoad } from "./load.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
/** Private command owner; runner callers never receive a database handle. */
export function postgresExecutionCommands(
  run: Run,
  capabilities: RunnerCapabilities,
): ExecutionRepository & ExecutionQueueControl {
  const cap = Object.freeze({ ...capabilities }),
    claims = postgresClaims(run, cap),
    checkpoints = postgresCheckpoints(run),
    staging = postgresCompletionStaging(run);
  const resumable = () => {
    if (!cap.resumable) throw new Error("Checkpoint capability unavailable");
  };
  return {
    ...claims,
    load: postgresExecutionLoad(run, cap.losslessCases && cap.losslessResults),
    beginCompletion: (job, header) => staging.begin(job, header),
    writeCompletionChunk: (job, chunk) => staging.chunk(job, chunk),
    sealCompletionFrame: (job, channel, ordinal, status) =>
      staging.seal(job, channel, ordinal, status),
    sealCompletionDiagnostics: (job) => staging.sealDiagnostics(job),
    finishCompletionStream: (job, proof) => staging.eof(job, proof),
    promoteCompletion: postgresCompletionPromotion(run),
    async loadCheckpoint(job) {
      resumable();
      return checkpoints.loadCheckpoint(job);
    },
    async replayCheckpoint(job, count, consume, signal) {
      resumable();
      return checkpoints.replayCheckpoint(job, count, consume, signal);
    },
    async saveCheckpoint(job, item) {
      resumable();
      return checkpoints.saveCheckpoint(job, item);
    },
    async yield(job, proof) {
      resumable();
      return checkpoints.yield(job, proof);
    },
  };
}
