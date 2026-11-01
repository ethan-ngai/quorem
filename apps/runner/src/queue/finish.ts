/** @file finish.ts @description Teardown-fenced runner terminal and yield operations. @module runner */
import type { ExecutionRepository, Job, SandboxControl } from "@quorem/execution";
/** No terminal publication occurs before the exact sandbox owner confirms teardown. */
export async function finishAfterTeardown(
  repository: ExecutionRepository,
  sandbox: SandboxControl,
  job: Job,
  signal?: AbortSignal,
): Promise<void> {
  const fence = { attemptId: job.attemptId, sandboxScope: job.sandboxScope };
  await sandbox.teardownAttempt(fence, signal);
  await repository.finishCompletionStream(job, fence, signal);
  await repository.promoteCompletion(job, fence, signal);
}
/** Yield releases a live attempt only after the sandbox has stopped. */
export async function yieldAfterTeardown(
  repository: ExecutionRepository,
  sandbox: SandboxControl,
  job: Job,
  signal?: AbortSignal,
): Promise<void> {
  const fence = { attemptId: job.attemptId, sandboxScope: job.sandboxScope };
  await sandbox.teardownAttempt(fence, signal);
  await repository.yield(job, fence, signal);
}
