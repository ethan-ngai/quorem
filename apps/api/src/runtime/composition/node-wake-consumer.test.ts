import { expect, it } from "vitest";
import { SQSClient } from "@aws-sdk/client-sqs";
import { sqsQueue } from "../../adapters/delivery/sqs.ts";
import { cloudflarePull } from "../../adapters/delivery/cloudflare.ts";
import type { WakeQueue } from "../../adapters/delivery/queue.ts";
import { startNodeWakeConsumer } from "./node-wake-consumer.ts";

const wake = { jobId: "job-1", phase: "admission" as const, admissionUntil: Date.now() + 30000 };
const options = {
  drainURL: "http://127.0.0.1:8787/internal/drain",
  credential: "fixture-drain-credential-32-characters",
  local: true,
  report() {},
};
const tick = async (predicate: () => boolean) => {
  for (let i = 0; i < 100 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(predicate()).toBe(true);
};
it.each(["sqs", "cloudflare"] as const)(
  "%s consumes early wake only after durable continuation",
  async (provider) => {
    const events: string[] = [];
    let delivered = false;
    const queue: WakeQueue =
      provider === "sqs"
        ? sqsQueue("https://sqs.us-east-1.amazonaws.com/000000000000/test", {
            send: async (command: { constructor: { name: string } }) => {
              const name = command.constructor.name;
              events.push(name);
              if (name === "ReceiveMessageCommand") {
                if (delivered) return {};
                delivered = true;
                return { Messages: [{ Body: JSON.stringify(wake), ReceiptHandle: "receipt" }] };
              }
              return {};
            },
          } as unknown as SQSClient)
        : cloudflarePull({
            accountId: "account",
            queueId: "queue",
            token: "token",
            fetch: async (input) => {
              const path = new URL(
                input instanceof Request ? input.url : input instanceof URL ? input.href : input,
              ).pathname;
              events.push(path);
              if (path.endsWith("/pull")) {
                if (delivered) return Response.json({ success: true, result: { messages: [] } });
                delivered = true;
                return Response.json({
                  success: true,
                  result: { messages: [{ body: JSON.stringify(wake), lease_id: "receipt" }] },
                });
              }
              if (path.endsWith("/ack"))
                return Response.json({ success: true, result: { ackCount: 1 } });
              return Response.json({ success: true, result: {} });
            },
          });
    const stop = await startNodeWakeConsumer(queue, {
      ...options,
      fetch: async () => new Response('{"queued":0,"running":0}', { status: 200 }),
    });
    try {
      const ack =
        provider === "sqs"
          ? "DeleteMessageCommand"
          : "/client/v4/accounts/account/queues/queue/messages/ack";
      const send =
        provider === "sqs"
          ? "SendMessageCommand"
          : "/client/v4/accounts/account/queues/queue/messages";
      await tick(() => events.includes(ack));
      expect(events.indexOf(send)).toBeGreaterThanOrEqual(0);
      expect(events.indexOf(send)).toBeLessThan(events.indexOf(ack));
    } finally {
      await stop();
    }
  },
);
it("lost acknowledgement redelivers and shutdown does not acknowledge in-flight work", async () => {
  let receive = 0,
    ack = 0,
    sends = 0;
  const queue: WakeQueue = {
    send: async () => {
      sends++;
    },
    receive: async () => {
      receive++;
      return receive <= 2 ? [{ wake, receipt: String(receive) }] : [];
    },
    ack: async () => {
      ack++;
      if (ack === 1) throw new Error("lost ack");
    },
    retry: async () => {},
  };
  const stop = await startNodeWakeConsumer(queue, {
    ...options,
    fetch: async () => new Response('{"queued":0,"running":0}'),
  });
  try {
    await tick(() => ack === 2);
    expect(sends).toBe(2);
  } finally {
    await stop();
  }
  let acknowledged = false;
  const blocked: WakeQueue = {
    send: async () => {},
    receive: async () => [{ wake, receipt: "receipt" }],
    ack: async () => {
      acknowledged = true;
    },
    retry: async () => {},
  };
  let entered = false;
  const close = await startNodeWakeConsumer(blocked, {
    ...options,
    fetch: async (_input, init) => {
      entered = true;
      return await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  await tick(() => entered);
  await close();
  expect(acknowledged).toBe(false);
});

it("shutdown is bounded while a long poll is still pending", async () => {
  let requested = false;
  const queue: WakeQueue = {
    send: async () => {},
    receive: async () => {
      requested = true;
      return await new Promise(() => {});
    },
    ack: async () => {
      throw new Error("unexpected");
    },
    retry: async () => {
      throw new Error("unexpected");
    },
  };
  const close = await startNodeWakeConsumer(queue, options);
  await tick(() => requested);
  const start = performance.now();
  await close();
  expect(performance.now() - start).toBeLessThan(500);
});

it("retries a delivery when continuation publication fails", async () => {
  let received = false,
    retried = false,
    acked = false;
  const queue: WakeQueue = {
    send: async () => {
      throw new Error("unavailable");
    },
    receive: async () => {
      if (received) return [];
      received = true;
      return [{ wake, receipt: "receipt" }];
    },
    ack: async () => {
      acked = true;
    },
    retry: async () => {
      retried = true;
    },
  };
  const stop = await startNodeWakeConsumer(queue, {
    ...options,
    fetch: async () => new Response('{"queued":0,"running":0}'),
  });
  try {
    await tick(() => retried);
    expect(acked).toBe(false);
  } finally {
    await stop();
  }
});
