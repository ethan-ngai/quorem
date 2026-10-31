/** @file wire.ts @description Bounded execution wake wire values. @module delivery */
import type { Wake } from "../../modules/events/dispatch/ports.ts";
export function encodeWake(wake: Wake): string {
  if (
    !/^[A-Za-z0-9-]{1,128}$/.test(wake.jobId) ||
    !["admission", "continuation"].includes(wake.phase) ||
    (wake.admissionUntil !== undefined &&
      (!Number.isSafeInteger(wake.admissionUntil) || wake.admissionUntil < 1))
  )
    throw new Error("Invalid execution wake");
  if (wake.phase === "admission" && wake.admissionUntil === undefined)
    throw new Error("Invalid execution wake");
  return JSON.stringify({
    jobId: wake.jobId,
    phase: wake.phase,
    ...(wake.admissionUntil === undefined ? {} : { admissionUntil: wake.admissionUntil }),
  });
}
export function decodeWake(body: string): Wake {
  if (body.length > 1024) throw new Error("Invalid execution wake");
  let value: Wake;
  try {
    value = JSON.parse(body) as Wake;
    encodeWake(value);
  } catch {
    throw new Error("Invalid execution wake");
  }
  return value;
}
export function validateDelay(delay: number): void {
  if (!Number.isInteger(delay) || delay < 0 || delay > 900)
    throw new RangeError("Invalid wake delay");
}

export function validateRetryDelay(delay: number): void {
  if (!Number.isInteger(delay) || delay < 0 || delay > 43200)
    throw new RangeError("Invalid retry delay");
}
