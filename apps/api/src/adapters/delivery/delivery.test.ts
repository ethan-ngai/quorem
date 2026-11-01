/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { SQSClient } from "@aws-sdk/client-sqs";
import { cloudflareBinding, cloudflarePull, type QueueBinding } from "./cloudflare.ts";
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
    const sent: Parameters<QueueBinding["send"]>[] = [];
    const adapter = cloudflareBinding({
      send: async (...args) => {
        sent.push(args);
      },
    });
    await adapter.send({ jobId: "job-1", phase: "continuation", admissionUntil: 12345 }, 2);
    expect(decodeWake(sent[0]![0]).admissionUntil).toBe(12345);
    expect(sent[0]![1]).toEqual({ delaySeconds: 2 });
  });
  it("uses Cloudflare pull, receipt ack and retry protocol", async () => {
    type PullBody = {
      delay_seconds?: number;
      acks?: { lease_id: string }[];
      retries?: { delay_seconds: number }[];
    };
    const calls: { url: string; body: PullBody }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      calls.push({ url: request.url, body: (await request.json()) as PullBody });
      const result = request.url.endsWith("/pull")
        ? { messages: [{ body: '{"jobId":"job-1","phase":"continuation"}', lease_id: "receipt" }] }
        : request.url.endsWith("/ack")
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
    expect(calls[2]?.body.acks?.[0]?.lease_id).toBe("receipt");
    expect(calls[3]?.body.retries?.[0]?.delay_seconds).toBe(2);
  });
  it("sends SQS commands and redacts transport failures", async () => {
    const names: string[] = [];
    const client = new SQSClient({
      region: "us-east-1",
      credentials: { accessKeyId: "fixture-access", secretAccessKey: "fixture-secret" },
      requestHandler: {
        handle: async (request: { headers: Record<string, string>; body?: unknown }) => {
          const action = request.headers["x-amz-target"]?.split(".").at(-1);
          names.push(action ?? "");
          const payload = JSON.parse(
            typeof request.body === "string"
              ? request.body
              : new TextDecoder().decode(request.body as Uint8Array),
          ) as { MessageBody?: string };
          const md5 = (body: string) => createHash("md5").update(body).digest("hex");

          return {
            response: {
              statusCode: 200,
              headers: { "content-type": "application/x-amz-json-1.0" },
              body: new TextEncoder().encode(
                JSON.stringify(
                  action === "ReceiveMessage"
                    ? {
                        Messages: [
                          {
                            Body: '{"jobId":"job-1","phase":"continuation"}',
                            ReceiptHandle: "r",
                            MessageId: "fixture-message",
                            MD5OfBody: md5('{"jobId":"job-1","phase":"continuation"}'),
                          },
                        ],
                      }
                    : action === "SendMessage"
                      ? {
                          MessageId: "fixture-message",
                          MD5OfMessageBody: md5(payload.MessageBody ?? ""),
                        }
                      : {},
                ),
              ),
            },
          };
        },
      },
    });
    const queue = sqsQueue("https://sqs.us-east-1.amazonaws.com/123/queue", client);
    await queue.send({ jobId: "job-1", phase: "continuation" }, 2);
    await queue.receive(1);
    await queue.ack("r");
    await queue.retry("r", 3);
    expect(names).toEqual([
      "SendMessage",
      "ReceiveMessage",
      "DeleteMessage",
      "ChangeMessageVisibility",
    ]);
    const failingClient = new SQSClient({
      region: "us-east-1",
      credentials: { accessKeyId: "fixture-access", secretAccessKey: "fixture-secret" },
      requestHandler: {
        handle: async () => {
          throw new Error("secret");
        },
      },
    });
    const failing = sqsQueue("https://sqs.us-east-1.amazonaws.com/123/queue", failingClient);
    await expect(failing.send({ jobId: "job-1", phase: "continuation" })).rejects.toThrow(
      "Execution wake unavailable",
    );
  });
});
