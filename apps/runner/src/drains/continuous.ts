/** @file continuous.ts @description Durable wake consumption and continuation ordering. @module runner */
import { setTimeout as sleep } from "node:timers/promises";
import type { Drainer } from "./drain.ts";

export interface WakeDelivery {
  /** Persist another wake before acknowledging an incomplete drain. */
  continue(signal: AbortSignal): Promise<void>;
  acknowledge(signal: AbortSignal): Promise<void>;
  retry(signal: AbortSignal): Promise<void>;
}
export interface WakeSource {
  /** A timeout may return null; reconnecting must resume from durable provider state. */
  receive(signal: AbortSignal): Promise<WakeDelivery | null>;
}
/** Delivery payloads never authorize a job; each drain claims through the database owner. */
export async function consumeWakes(options: {
  drainer: Drainer;
  source: WakeSource;
  signal: AbortSignal;
  retryMs?: number;
}): Promise<void> {
  const retryMs = options.retryMs ?? 1000;
  if (!Number.isSafeInteger(retryMs) || retryMs < 1) throw new Error("Invalid wake retry interval");
  while (!options.signal.aborted) {
    let delivery: WakeDelivery | null;
    try {
      delivery = await options.source.receive(options.signal);
    } catch {
      if (options.signal.aborted) break;
      await sleep(retryMs, undefined, { signal: options.signal });
      continue;
    }
    if (!delivery) continue;
    try {
      options.drainer.refresh();
      const result = await options.drainer.drain(options.signal);
      if (!result.complete) await delivery.continue(options.signal);
      await delivery.acknowledge(options.signal);
    } catch {
      if (options.signal.aborted) break;
      await delivery.retry(options.signal);
    }
  }
}
