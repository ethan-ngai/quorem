/** @file wake-consumer.ts @description Durable queue wake consumption through the trusted runner. @module runtime */
import { consumeWake } from "../../modules/events/dispatch/dispatch.ts";
import { decodeWake } from "../../adapters/delivery/wire.ts";
import type { ExecutionWakePublisher } from "../../modules/events/dispatch/ports.ts";
export interface WakeMessage {
  body: unknown;
  attempts?: number;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}
/** Validate the bounded private runner endpoint before any wake is consumed. */
export function validateDrainTransport(drainURL: string, credential: string, local: boolean): URL {
  let url: URL;
  try {
    url = new URL(drainURL);
  } catch {
    throw new Error("Invalid drain URL");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/internal/drain" ||
    (url.protocol !== "https:" &&
      !(
        local &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    new TextEncoder().encode(credential).length < 32 ||
    /\s/.test(credential)
  )
    throw new Error("Invalid drain configuration");
  return url;
}
/** Acknowledgment follows confirmed drain or durable continuation publication. */
export async function consumeWakeBatch(
  messages: readonly WakeMessage[],
  options: {
    publisher: ExecutionWakePublisher;
    drainURL: string;
    credential: string;
    local: boolean;
    fetch?: typeof fetch;
  },
): Promise<void> {
  const url = validateDrainTransport(options.drainURL, options.credential, options.local);
  const drain = async () => {
    const response = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: { authorization: `Bearer ${options.credential}` },
      redirect: "manual",
      signal: AbortSignal.timeout(210000),
    });
    if (![200, 202].includes(response.status)) {
      await response.body?.cancel();
      throw new Error("Drain unavailable");
    }
    if (!response.body) throw new Error("Invalid drain response");
    const reader = response.body.getReader();
    let size = 0,
      text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 4096) {
          await reader.cancel();
          throw new Error("Invalid drain response");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid drain response");
    const { queued, running } = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(queued) ||
      !Number.isSafeInteger(running) ||
      (queued as number) < 0 ||
      (running as number) < 0 ||
      (response.status === 200 && (queued !== 0 || running !== 0))
    )
      throw new Error("Invalid drain response");
    return { pending: response.status === 202 };
  };
  for (const message of messages) {
    try {
      if (typeof message.body !== "string") throw new Error("Invalid wake");
      await consumeWake(decodeWake(message.body), options.publisher, drain);
      message.ack();
    } catch {
      message.retry({ delaySeconds: Math.min(30, 2 ** Math.min(message.attempts ?? 1, 5)) });
    }
  }
}
