/** @file drain.ts @description Bounded wake-driven execution drains. @module runner */
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecutionRepository, SandboxControl } from "@quorem/execution";
import { UnconfirmedTeardown } from "../sandbox/types.ts";
import { claimNext } from "../queue/claim.ts";
import {
  runAttempt,
  type AttemptEngine,
  type CancellationSource,
} from "../orchestration/attempt.ts";

export interface QueueWatch {
  next(signal: AbortSignal): Promise<"changed" | "closed">;
  close(): Promise<void>;
}
/** State and empty confirmation must come from the authoritative admission owner. */
export interface QueueSignals {
  subscribe(signal: AbortSignal): Promise<QueueWatch>;
  state(signal: AbortSignal): Promise<{ queued: number; running: number }>;
  confirmEmpty(signal: AbortSignal): Promise<boolean>;
  nextDeadline(signal: AbortSignal): Promise<number | null>;
}
export interface DrainState {
  queued: number;
  running: number;
  complete: boolean;
}
export interface Drainer {
  drain(signal: AbortSignal): Promise<DrainState>;
  refresh(): void;
}
export function drainer(options: {
  repository: ExecutionRepository;
  sandbox: SandboxControl & { scope: string };
  cancellations: CancellationSource;
  engine: AttemptEngine;
  queue: QueueSignals;
  slots: number;
  resumable: boolean;
  graceMs?: number;
  claimWindowMs?: number;
}): Drainer {
  const { repository, sandbox, cancellations, engine, queue } = options;
  if (!Number.isInteger(options.slots) || options.slots < 1 || options.slots > 8)
    throw new Error("Invalid runner concurrency");
  const graceMs = options.graceMs ?? 15000,
    claimWindowMs = options.claimWindowMs ?? 55000;
  if (
    !Number.isSafeInteger(graceMs) ||
    graceMs < 1 ||
    !Number.isSafeInteger(claimWindowMs) ||
    claimWindowMs < 1
  )
    throw new Error("Invalid drain timing");
  let epoch = 0,
    active = false;
  return {
    refresh() {
      epoch++;
    },
    async drain(signal) {
      if (active) throw new Error("Drain already active");
      active = true;
      const stop = new AbortController();
      const live = AbortSignal.any([signal, stop.signal]);
      let watch: QueueWatch | undefined;
      let lastEpoch = epoch,
        graceUntil = performance.now() + graceMs;
      const claimUntil = performance.now() + claimWindowMs;
      let failure: unknown,
        teardownFailure: UnconfirmedTeardown | undefined,
        running = 0,
        wake = 0,
        contentionMs = 200,
        retryAt = 0;
      const workers = new Set<Promise<void>>();
      const start = () => {
        while (
          !failure &&
          !live.aborted &&
          running < options.slots &&
          performance.now() < claimUntil
        ) {
          running++;
          const worker = (async () => {
            let worked = false;
            try {
              while (!live.aborted && performance.now() < claimUntil) {
                const job = await claimNext(repository, sandbox, {
                  resumable: options.resumable,
                  scope: sandbox.scope,
                  signal: live,
                });
                if (!job) break;
                worked = true;
                await runAttempt({ repository, sandbox, cancellations, engine, job, signal: live });
              }
            } catch (error) {
              if (error instanceof UnconfirmedTeardown) teardownFailure = error;
              if (!live.aborted) failure = error;
            } finally {
              running--;
              if (worked) wake++;
            }
          })();
          workers.add(worker);
          void worker.finally(() => workers.delete(worker));
        }
      };
      try {
        return await (async () => {
          try {
            watch = await queue.subscribe(live);
            const notifications = (async () => {
              try {
                while (!live.aborted) {
                  if ((await watch!.next(live)) === "closed")
                    throw new Error("Execution notification unavailable");
                  wake++;
                }
              } catch (error) {
                if (!live.aborted) failure = error;
              }
            })();
            start();
            while (!live.aborted) {
              if (failure) throw failure;
              if (epoch !== lastEpoch) {
                lastEpoch = epoch;
                graceUntil = performance.now() + graceMs;
                wake++;
              }
              const beforeWake = wake;
              const state = await queue.state(live);
              if (
                !running &&
                state.queued === 0 &&
                state.running === 0 &&
                performance.now() >= graceUntil
              ) {
                const before = epoch;
                if ((await queue.confirmEmpty(live)) && before === epoch && beforeWake === wake)
                  return { ...state, complete: true };
                wake++;
              }
              if (!running && performance.now() >= claimUntil) return { ...state, complete: false };
              const deadline = await queue.nextDeadline(live);
              const untilGrace =
                graceUntil > performance.now() ? graceUntil - performance.now() : Infinity;
              const now = performance.now();
              const deadlineDelay =
                deadline === null
                  ? Infinity
                  : deadline <= 0
                    ? Math.max(0, retryAt - now)
                    : Math.max(200, deadline);
              const delay = Math.max(1, Math.min(200, deadlineDelay, untilGrace));
              await sleep(delay, undefined, { signal: live });
              if (wake !== beforeWake) {
                contentionMs = 200;
                retryAt = 0;
                start();
              } else if (deadline !== null && deadlineDelay <= delay) {
                retryAt = performance.now() + contentionMs;
                contentionMs = Math.min(5000, contentionMs * 2);
                start();
              }
            }
            await notifications;
            throw signal.reason ?? new Error("Drain stopped");
          } finally {
            stop.abort();
            try {
              await watch?.close();
            } finally {
              await Promise.all(workers);
              active = false;
            }
          }
        })();
      } catch (error) {
        if (teardownFailure) throw teardownFailure;
        throw error;
      }
    },
  };
}
