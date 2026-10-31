/** @file control.ts @description Portable, bounded authoritative control checks. @module runner */
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecutionQueueControl } from "@quorem/execution";
import type { CancellationSource } from "./attempt.ts";
import type { QueueSignals } from "../drains/drain.ts";

/** A control tick triggers a live lease read; it is not itself cancellation authority. */
export function controlPolling(intervalMs = 1000): CancellationSource {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1)
    throw new Error("Invalid control interval");
  return {
    async subscribe() {
      return {
        async next(signal) {
          await sleep(intervalMs, undefined, { signal });
          return "changed";
        },
        async close() {},
      };
    },
  };
}
/** Active HTTP drains recheck database state; idle HTTP instances issue no requests. */
export function queueControl(
  control: ExecutionQueueControl,
  scope: string,
  intervalMs = 1000,
): QueueSignals {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1)
    throw new Error("Invalid queue interval");
  return {
    async subscribe() {
      return {
        async next(signal) {
          await sleep(intervalMs, undefined, { signal });
          return "changed";
        },
        async close() {},
      };
    },
    state: (signal) => control.queueState(signal),
    confirmEmpty: (signal) => control.confirmQueueEmpty(signal),
    nextDeadline: (signal) => control.nextRunnableDeadline(scope, signal),
  };
}
