/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { privateRunnerCommands } from "./http.ts";
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
