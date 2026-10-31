/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExecutionInputReader, Job } from "@quorem/execution";
import { spoolInput } from "../checkpoints/input-spool.ts";
import { caseSpans } from "./case-spans.ts";
const job = { jobId: "j", submissionId: "s", attemptId: "a", sandboxScope: "scope" } as Job;
async function fixture(raw: string) {
  const bytes = new TextEncoder().encode(raw),
    hash = createHash("sha256").update(bytes).digest("hex");
  const reader = {
    inputPage: async (_job, _kind, _ordinal, offset) => ({
      hash,
      size: bytes.length,
      channel: "private",
      bytes: bytes.subarray(offset, offset + 65536),
    }),
  } as ExecutionInputReader;
  return spoolInput({ reader, job, kind: "case", ordinal: 0 });
}
async function text(source: AsyncIterable<Uint8Array>): Promise<string> {
  const all: Uint8Array[] = [];
  for await (const part of source) all.push(part);
  return new TextDecoder().decode(Buffer.concat(all));
}
void test("streams lossless case inputs while keeping top-level and call expectations private", async () => {
  const large = "x".repeat(180000),
    raw = JSON.stringify({
      args: ["λ\u0000", large, 9007199254740993n.toString()],
      expected: "SECRET-EXPECTED",
      calls: [
        { methodName: "go", args: ["α", 1], expected: "SECRET-CALL" },
        { methodName: "next", args: null, expected: 99 },
      ],
    });
  const spool = await fixture(raw);
  try {
    const view = await caseSpans(spool);
    assert.equal(
      await text(view.args()),
      JSON.stringify(["λ\u0000", large, 9007199254740993n.toString()]),
    );
    const calls = await text(view.requestCalls());
    assert.deepEqual(JSON.parse(calls), [
      { methodName: "go", args: ["α", 1] },
      { methodName: "next", args: [] },
    ]);
    assert.doesNotMatch(calls, /SECRET|expected/);
    assert.ok(view.expected);
    assert.ok(view.calls[0].has("expected"));
  } finally {
    await spool.dispose();
  }
});
void test("duplicate or unknown nested fields fail closed", async () => {
  for (const raw of [
    '{"args":[],"args":[]}',
    '{"args":[],"calls":[{"methodName":"x","expected":1,"expected":2}]}',
    '{"args":[],"other":1}',
  ]) {
    const spool = await fixture(raw);
    try {
      await assert.rejects(caseSpans(spool));
    } finally {
      await spool.dispose();
    }
  }
});
void test(
  "real Docker consumes streamed projected arguments without expected values",
  { skip: !process.env.QUOREM_TEST_DOCKER_SOCKET, timeout: 60000 },
  async (t) => {
    const { defaultLimits } = await import("@quorem/execution");
    const { dockerSandbox } = await import("../sandbox/docker.ts");
    const { composedInput } = await import("../sandbox/input.ts");
    const root = await realpath(await mkdtemp(join(tmpdir(), "quorem-case-projection-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: process.env.QUOREM_TEST_DOCKER_SOCKET!,
      stateRoot: root,
      namespace: "projected",
      cleanupMs: 10000,
    });
    const spool = await fixture(
      JSON.stringify({ args: ["x".repeat(180000)], expected: "SECRET-PRIVATE-EXPECTED" }),
    );
    try {
      const view = await caseSpans(spool),
        enc = new TextEncoder();
      async function* payload() {
        yield enc.encode(
          '{"source":"class Solution:\\n def f(self,x): return len(x)","signature":{"className":"Solution","methodName":"f","parameters":[{"name":"x","type":"str"}],"returnType":"int"},"args":',
        );
        yield* view.args();
        yield enc.encode(',"calls":');
        yield* view.requestCalls();
        yield enc.encode(',"methods":{}}');
      }
      const input = await composedInput(payload);
      assert.doesNotMatch(await text(input.open()), /SECRET-PRIVATE-EXPECTED/);
      const fence = { attemptId: randomUUID(), sandboxScope: sandbox.scope };
      const output = await sandbox.runCase({
        fence,
        binding: "a".repeat(64),
        ordinal: 0,
        language: "python",
        limits: defaultLimits(),
        input,
        outputLimit: 65536,
        timeoutMs: 30000,
      });
      assert.equal(JSON.parse(new TextDecoder().decode(output.stdout).slice(1)).actual, 180000);
      await sandbox.teardownAttempt(fence);
    } finally {
      await spool.dispose();
    }
  },
);
