/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { expect, it } from "vitest";
import worker, { type Env } from "../worker.ts";
it("acknowledges native queue messages only after the drain and durable continuation", async () => {
  const original = globalThis.fetch;
  let status = 200,
    sends = 0,
    fail = false;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ queued: status === 200 ? 0 : 1, running: 0 }), {
      status,
      headers: { "content-type": "application/json" },
    });
  const config = {
    ...(env as unknown as Env),
    EXECUTION_DRAIN_URL: "http://127.0.0.1:9999/internal/drain",
    EXECUTION_DRAIN_SECRET: "fixture-drain-credential-32-characters",
    RUNNER_PEERS: JSON.stringify([
      { secret: "fixture-runner-credential-32-characters", scope: "fixture", resumable: true },
    ]),
    VERIFICATION_SOURCE_CREDENTIAL: "11".repeat(32),
    VERIFICATION_SERVICE_CREDENTIAL: "22".repeat(32),
    VERIFICATION_SERVICE_ORIGIN: "http://127.0.0.1:9998",
    VERIFICATION_PUBLIC_KEY: "fixture",
    EXECUTION_QUEUE: {
      async send() {
        sends++;
        if (fail) throw new Error("queue unavailable");
      },
    },
  };
  const batch = (id: string, body: string) =>
    createMessageBatch("runtime-test-wakes", [{ id, timestamp: new Date(), attempts: 1, body }]);
  try {
    const early = batch(
      "early",
      JSON.stringify({ jobId: "early", phase: "admission", admissionUntil: Date.now() + 10000 }),
    );
    await worker.queue(early, config);
    expect((await getQueueResult(early, createExecutionContext())).explicitAcks).toEqual(["early"]);
    expect(sends).toBe(1);
    status = 202;
    fail = true;
    const pending = batch("pending", JSON.stringify({ jobId: "pending", phase: "continuation" }));
    await worker.queue(pending, config);
    const retried = await getQueueResult(pending, createExecutionContext());
    expect(retried.explicitAcks).toEqual([]);
    expect(retried.retryMessages.map((message) => message.msgId)).toEqual(["pending"]);
  } finally {
    globalThis.fetch = original;
  }
});
