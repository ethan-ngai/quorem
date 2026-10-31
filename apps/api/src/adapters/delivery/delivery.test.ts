import { describe, expect, it } from "vitest";
import { cloudflareBinding, cloudflarePull } from "./cloudflare.ts";
import { sqsQueue } from "./sqs.ts";
import { decodeWake } from "./wire.ts";
import { consumeReceivedWake } from "./consume.ts";

describe("execution wake providers", () => {
  it("acknowledges only after the continuation is durable", async () => {
    const calls: string[] = [];
    const queue = {
      send: async () => {
        calls.push("send");
        throw new Error("unavailable");
      },
      ack: async () => {
        calls.push("ack");
      },
      receive: async () => [],
      retry: async () => {},
    };
    const message = {
      wake: { jobId: "job-1", phase: "admission" as const, admissionUntil: Date.now() + 5000 },
      receipt: "receipt",
    };
    await expect(
      consumeReceivedWake(queue, message, async () => ({ pending: false })),
    ).rejects.toThrow("unavailable");
    expect(calls).toEqual(["send"]);
    await consumeReceivedWake(
      {
        ...queue,
        send: async () => {
          calls.push("send");
        },
      },
      message,
      async () => ({ pending: false }),
    );
    expect(calls).toEqual(["send", "send", "ack"]);
  });
  it("passes deadline and delay through native Cloudflare binding", async () => {
    const sent: unknown[] = [];
    const adapter = cloudflareBinding({
      send: async (...args) => {
        sent.push(args);
      },
    });
    await adapter.send({ jobId: "job-1", phase: "continuation", admissionUntil: 12345 }, 2);
    expect(decodeWake(sent[0]![0] as string).admissionUntil).toBe(12345);
    expect(sent[0]![1]).toEqual({ delaySeconds: 2 });
  });
  it("uses Cloudflare pull, receipt ack and retry protocol", async () => {
    const calls: { url: string; body: any }[] = [];
    const fake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      const result = String(input).endsWith("/pull")
        ? { messages: [{ body: '{"jobId":"job-1","phase":"continuation"}', lease_id: "receipt" }] }
        : String(input).endsWith("/ack")
          ? calls.at(-1)!.body.acks
            ? { ackCount: 1 }
            : { retryCount: 1 }
          : {};
      return Response.json({ success: true, result });
    };
    const queue = cloudflarePull({
      accountId: "account",
      queueId: "queue",
      token: "secret",
      fetch: fake,
    });
    await queue.send({ jobId: "job-1", phase: "continuation" }, 2);
    expect((await queue.receive(1))[0]?.receipt).toBe("receipt");
    await queue.ack("receipt");
    await queue.retry("receipt", 2);
    expect(calls[0]?.body.delay_seconds).toBe(2);
    expect(calls[2]?.body.acks[0].lease_id).toBe("receipt");
    expect(calls[3]?.body.retries[0].delay_seconds).toBe(2);
  });
  it("sends SQS commands and redacts transport failures", async () => {
    const names: string[] = [];
    const client = {
      send: async (command: { constructor: { name: string } }) => {
        names.push(command.constructor.name);
        if (command.constructor.name === "ReceiveMessageCommand")
          return {
            Messages: [{ Body: '{"jobId":"job-1","phase":"continuation"}', ReceiptHandle: "r" }],
          };
        return {};
      },
    };
    const queue = sqsQueue("https://sqs.us-east-1.amazonaws.com/123/queue", client as never);
    await queue.send({ jobId: "job-1", phase: "continuation" }, 2);
    await queue.receive(1);
    await queue.ack("r");
    await queue.retry("r", 3);
    expect(names).toEqual([
      "SendMessageCommand",
      "ReceiveMessageCommand",
      "DeleteMessageCommand",
      "ChangeMessageVisibilityCommand",
    ]);
    const failing = sqsQueue("https://sqs.us-east-1.amazonaws.com/123/queue", {
      send: async () => {
        throw new Error("secret");
      },
    } as never);
    await expect(failing.send({ jobId: "job-1", phase: "continuation" })).rejects.toThrow(
      "Execution wake unavailable",
    );
  });
});
