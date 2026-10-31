/** @file node-wake-consumer.ts @description Bounded Node consumption of durable execution wakes. @module runtime */
import type { WakeQueue } from "../../adapters/delivery/queue.ts";
import { encodeWake } from "../../adapters/delivery/wire.ts";
import { consumeWakeBatch } from "./wake-consumer.ts";

type Options = {
  drainURL: string;
  credential: string;
  local: boolean;
  fetch?: typeof fetch;
  report: () => void;
};
/** Unacknowledged deliveries remain available after abort or uncertain provider responses. */
export async function startNodeWakeConsumer(
  queue: WakeQueue,
  options: Options,
): Promise<() => Promise<void>> {
  const controller = new AbortController(),
    signal = controller.signal;
  const send: typeof fetch = (input, init) =>
    (options.fetch ?? fetch)(input, {
      ...init,
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    });
  await consumeWakeBatch([], { ...options, publisher: queue, fetch: send });
  const wait = async <T>(promise: Promise<T>): Promise<T> => {
    if (signal.aborted) throw new Error("Consumer stopped");
    let abort: () => void = () => {};
    const interruption = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("Consumer stopped"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([promise, interruption]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  const loop = (async () => {
    while (!signal.aborted) {
      try {
        const messages = await wait(queue.receive(1));
        for (const message of messages) {
          if (signal.aborted) break;
          let disposition: "ack" | "retry" | undefined;
          let delay = 1;
          await wait(
            consumeWakeBatch(
              [
                {
                  body: encodeWake(message.wake),
                  ack() {
                    disposition = "ack";
                  },
                  retry(options) {
                    disposition = "retry";
                    delay = options.delaySeconds;
                  },
                },
              ],
              { ...options, publisher: queue, fetch: send },
            ),
          );
          if (signal.aborted) break;
          if (disposition === "ack") await wait(queue.ack(message.receipt));
          else if (disposition === "retry") await wait(queue.retry(message.receipt, delay));
          else throw new Error("Missing wake disposition");
        }
        if (!messages.length) await wait(new Promise<void>((resolve) => setTimeout(resolve, 250)));
      } catch {
        if (signal.aborted) break;
        options.report();
        try {
          await wait(new Promise<void>((resolve) => setTimeout(resolve, 1000)));
        } catch {
          break;
        }
      }
    }
  })();
  return async () => {
    controller.abort();
    await loop;
  };
}
