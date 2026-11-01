/** @file attempt.ts @description Lease-bound execution and teardown. @module runner */
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecutionRepository, Job, SandboxControl } from "@quorem/execution";
import { finishAfterTeardown, yieldAfterTeardown } from "../queue/finish.ts";

export interface CancellationSubscription {
  /** An event is a hint; a closed or failed stream revokes the execution. */
  next(signal: AbortSignal): Promise<"changed" | "closed">;
  close(): Promise<void>;
}
export interface CancellationSource {
  subscribe(submissionId: string, signal: AbortSignal): Promise<CancellationSubscription>;
}
export type AttemptOutcome = "complete" | "yield";
export interface AttemptEngine {
  execute(job: Job, signal: AbortSignal): Promise<AttemptOutcome>;
}
export class LostLease extends Error {
  constructor() {
    super("Execution lease unavailable");
  }
}
/** Never publish or yield after losing the authoritative lease or cancellation listener. */
export async function runAttempt(options: {
  repository: ExecutionRepository;
  sandbox: SandboxControl;
  cancellations: CancellationSource;
  engine: AttemptEngine;
  job: Job;
  signal?: AbortSignal;
  attemptMs?: number;
  heartbeatMs?: number;
  teardownMs?: number;
}): Promise<AttemptOutcome> {
  const { repository, sandbox, cancellations, engine, job } = options;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(options.attemptMs ?? 120000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let watch: CancellationSubscription | undefined;
  let lost = false;
  let failure: unknown;
  let outcome: AttemptOutcome | undefined;
  const stop = new AbortController();
  const check = async (heartbeat: boolean) => {
    if (!(await repository.lease(job, heartbeat, signal))) throw new LostLease();
  };
  let heartbeat: Promise<void> | undefined;
  let cancellation: Promise<void> | undefined;
  try {
    watch = await cancellations.subscribe(job.submissionId, signal);
    await check(false);
    const fail = () => {
      lost = true;
      controller.abort();
    };
    heartbeat = (async () => {
      try {
        while (!stop.signal.aborted) {
          await sleep(options.heartbeatMs ?? 15000, undefined, { signal: stop.signal });
          await check(true);
        }
      } catch {
        if (!stop.signal.aborted) fail();
      }
    })();
    cancellation = (async () => {
      try {
        while (!stop.signal.aborted) {
          if ((await watch!.next(stop.signal)) === "closed") throw new LostLease();
          await check(false);
        }
      } catch {
        if (!stop.signal.aborted) fail();
      }
    })();
    outcome = await engine.execute(job, signal);
    if (signal.aborted || lost) throw new LostLease();
  } catch (error) {
    failure = error;
  } finally {
    stop.abort();
    try {
      await watch?.close();
    } catch (error) {
      failure ??= error;
    }
    await Promise.all([heartbeat, cancellation]);
  }
  if (failure || lost || signal.aborted) {
    // Teardown must outlive cancellation; a failed confirmation keeps the lease fenced.
    await sandbox.teardownAttempt(job, AbortSignal.timeout(options.teardownMs ?? 30000));
    throw failure ?? new LostLease();
  }
  const finalSignal = AbortSignal.timeout(options.teardownMs ?? 30000);
  if (outcome === "yield") await yieldAfterTeardown(repository, sandbox, job, finalSignal);
  else await finishAfterTeardown(repository, sandbox, job, finalSignal);
  return outcome!;
}
