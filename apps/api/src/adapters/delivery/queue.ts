/** @file queue.ts @description Receipt-scoped at-least-once wake delivery. @module delivery */
import type { Wake, ExecutionWakePublisher } from "../../modules/events/dispatch/ports.ts";
export interface ReceivedWake {
  wake: Wake;
  receipt: string;
}
export interface WakeQueue extends ExecutionWakePublisher {
  receive(limit: number): Promise<ReceivedWake[]>;
  ack(receipt: string): Promise<void>;
  retry(receipt: string, delaySeconds: number): Promise<void>;
}
export function validateReceipt(receipt: string): void {
  if (!receipt || receipt.length > 4096) throw new Error("Invalid receipt");
}
export function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new RangeError("Invalid batch limit");
}
