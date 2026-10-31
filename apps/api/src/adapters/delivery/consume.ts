/** @file consume.ts @description Acknowledge execution wakes after durable continuation. @module delivery */
import { consumeWake } from "../../modules/events/dispatch/dispatch.ts";
import type { ReceivedWake, WakeQueue } from "./queue.ts";

export async function consumeReceivedWake(
  queue: WakeQueue,
  message: ReceivedWake,
  drain: () => Promise<{ pending: boolean }>,
): Promise<void> {
  await consumeWake(message.wake, queue, drain);
  await queue.ack(message.receipt);
}
