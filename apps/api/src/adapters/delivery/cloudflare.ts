/** @file cloudflare.ts @description Cloudflare queue wake publishing. @module delivery */
import type { ExecutionWakePublisher, Wake } from "../../modules/events/dispatch/ports.ts";
import { encodeWake, decodeWake, validateDelay, validateRetryDelay } from "./wire.ts";
import { validateLimit, validateReceipt } from "./queue.ts";

async function boundedResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new Error();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export interface QueueBinding {
  send(body: string, options?: { delaySeconds: number }): Promise<void>;
}
export function cloudflareBinding(queue: QueueBinding): ExecutionWakePublisher {
  return {
    async send(wake, delaySeconds = 0) {
      const body = encodeWake(wake);
      validateDelay(delaySeconds);
      try {
        await queue.send(body, { delaySeconds });
      } catch {
        throw new Error("Execution wake unavailable");
      }
    },
  };
}
export function cloudflareRest(config: {
  accountId: string;
  queueId: string;
  token: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}): ExecutionWakePublisher {
  if (
    !/^[\w-]{1,64}$/.test(config.accountId) ||
    !/^[\w-]{1,64}$/.test(config.queueId) ||
    !config.token
  )
    throw new Error("Invalid queue configuration");
  const base = new URL(config.baseUrl ?? "https://api.cloudflare.com/client/v4");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new Error("Invalid queue endpoint");
  const url = `${base.href.replace(/\/$/, "")}/accounts/${config.accountId}/queues/${config.queueId}/messages`;
  return {
    async send(wake: Wake, delaySeconds = 0) {
      const body = encodeWake(wake);
      validateDelay(delaySeconds);
      try {
        const response = await (config.fetch ?? fetch)(url, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ body, content_type: "text", delay_seconds: delaySeconds }),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error();
        const text = await boundedResponse(response);
        if (JSON.parse(text).success !== true) throw new Error();
      } catch {
        throw new Error("Execution wake unavailable");
      }
    },
  };
}

/** REST pull queue for Node runners; binding-based push consumers use their native receipts. */
export function cloudflarePull(config: {
  accountId: string;
  queueId: string;
  token: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}): import("./queue.ts").WakeQueue {
  const publisher = cloudflareRest(config);
  const base = new URL(config.baseUrl ?? "https://api.cloudflare.com/client/v4");
  const endpoint = `${base.href.replace(/\/$/, "")}/accounts/${config.accountId}/queues/${config.queueId}/messages`;
  const request = async (path: string, body: unknown): Promise<any> => {
    try {
      const response = await (config.fetch ?? fetch)(endpoint + path, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const text = await boundedResponse(response);
      const parsed = JSON.parse(text);
      if (parsed.success !== true || !parsed.result) throw new Error();
      return parsed.result;
    } catch {
      throw new Error("Execution wake unavailable");
    }
  };
  return {
    send: (wake, delaySeconds) => publisher.send(wake, delaySeconds),
    async receive(limit) {
      validateLimit(limit);
      const result = await request("/pull", { batch_size: limit, visibility_timeout_ms: 30000 });
      if (!Array.isArray(result.messages) || result.messages.length > limit)
        throw new Error("Execution wake unavailable");
      return result.messages.map(
        (message: { body: string; lease_id: string; metadata?: Record<string, string> }) => {
          validateReceipt(message.lease_id);
          const content = message.metadata?.["CF-Content-Type"] ?? "text";
          let body = message.body;
          if (content === "json" || content === "bytes") body = atob(body);
          else if (content !== "text") throw new Error("Invalid execution wake");
          return { wake: decodeWake(body), receipt: message.lease_id };
        },
      );
    },
    async ack(receipt) {
      validateReceipt(receipt);
      const result = await request("/ack", { acks: [{ lease_id: receipt }] });
      if (result.ackCount !== 1) throw new Error("Execution wake unavailable");
    },
    async retry(receipt, delaySeconds) {
      validateReceipt(receipt);
      validateRetryDelay(delaySeconds);
      const result = await request("/ack", {
        retries: [{ lease_id: receipt, delay_seconds: delaySeconds }],
      });
      if (result.retryCount !== 1) throw new Error("Execution wake unavailable");
    },
  };
}
