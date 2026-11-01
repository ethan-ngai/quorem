/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { runnerConfig } from "../runtime/config.ts";
import { privateRunnerCommands, RunnerCommandError } from "./http.ts";
const secret = "fixture-only-private-runner-token-123456";
void test("private endpoint configuration rejects public HTTP, credentials and paths", () => {
  for (const origin of [
    "http://example.com",
    "https://u:p@example.com",
    "https://example.com/path",
    "https://example.com/?x=1",
    "https://example.com/#x",
  ])
    assert.throws(() =>
      privateRunnerCommands({ origin, secret, scope: "s", resumable: true, timeoutMs: 500 }),
    );
  assert.doesNotThrow(() =>
    privateRunnerCommands({
      origin: "http://127.0.0.1:55464",
      secret,
      scope: "s",
      resumable: true,
      timeoutMs: 500,
    }),
  );
});
void test("redirects fail closed, release bodies and never replay", async () => {
  let count = 0,
    cancelled = false;
  const fetcher: typeof fetch = async () => {
    count++;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status: 302, headers: { location: "https://attacker.invalid" } },
    );
  };
  const client = privateRunnerCommands({
    origin: "https://private.invalid",
    secret,
    scope: "s",
    resumable: true,
    timeoutMs: 500,
    fetch: fetcher,
  });
  await assert.rejects(client.nextExpiredAttempt(true, "s"), /unavailable/);
  assert.equal(count, 1);
  assert.equal(cancelled, true);
  await assert.rejects(client.claimAfterTeardown(true, "s", null), { outcome: "unknown" });
  assert.equal(count, 2);
});
void test("input pages enforce exact bounded response and cancel malformed bodies", async () => {
  let cancelled = false;
  const fetcher: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65537));
        },
        cancel() {
          cancelled = true;
        },
      }),
      {
        status: 200,
        headers: {
          "x-input-hash": "a".repeat(64),
          "x-input-size": "65536",
          "x-input-channel": "public",
        },
      },
    );
  const client = privateRunnerCommands({
    origin: "https://private.invalid",
    secret,
    scope: "s",
    resumable: true,
    timeoutMs: 500,
    fetch: fetcher,
  });
  const { defaultLimits } = await import("@quorem/execution");
  const job = {
    jobId: "j",
    submissionId: "s",
    attemptId: "a",
    sandboxScope: "s",
    problemVersionId: "p",
    runtimeRevision: "python-3.12-v1",
    harnessRevision: "quorem-harness-v2",
    sourceRef: "s",
    suiteRef: "p",
    language: "python",
    limits: defaultLimits(),
  };
  await assert.rejects(client.inputPage(job, "case", 0, 0), { outcome: "unavailable" });
  assert.equal(cancelled, true);
});

void test(
  "default command budget permits verifier responses beyond five seconds",
  { timeout: 15000 },
  async () => {
    const server = createServer((_request, response) => {
      setTimeout(
        () =>
          response
            .writeHead(200, { "content-type": "application/json" })
            .end('{"queued":0,"running":0}'),
        6000,
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const config = runnerConfig({
      QUOREM_RUNNER_MODE: "http",
      QUOREM_SANDBOX_PROVIDER: "remote",
      QUOREM_RUNNER_LISTEN: "127.0.0.1:8090",
      QUOREM_RUNNER_COMMAND_ORIGIN: `http://127.0.0.1:${port}`,
      QUOREM_RUNNER_COMMAND_SECRET: secret,
      QUOREM_RUNNER_DRAIN_SECRET: "fixture-distinct-drain-secret-1234567890",
      QUOREM_CASE_ORIGIN: "http://127.0.0.1:8081",
      QUOREM_CASE_SECRET: "fixture-distinct-case-secret-1234567890",
      QUOREM_CASE_NAMESPACE_ID: "a".repeat(64),
      QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: "/tmp/fixture-public-key.pem",
    });
    const client = privateRunnerCommands({
      origin: config.commandOrigin,
      secret,
      scope: "fixture",
      resumable: true,
      timeoutMs: config.commandTimeoutMs,
    });
    try {
      assert.deepEqual(await client.queueState(), { queued: 0, running: 0 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
void test("private command failures retain only operation, status and outcome", async () => {
  const client = privateRunnerCommands({
    origin: "https://private.invalid",
    secret,
    scope: "fixture",
    resumable: true,
    timeoutMs: 500,
    fetch: async () => new Response("private SQL and credentials", { status: 503 }),
  });
  await assert.rejects(client.queueState(), (error) => {
    assert.ok(error instanceof RunnerCommandError);
    assert.deepEqual(error.diagnostic, { operation: "state", status: 503, failure: "http" });
    assert.equal(JSON.stringify(error).includes("private SQL"), false);
    return true;
  });
});
