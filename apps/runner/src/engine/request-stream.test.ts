/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultLimits,
  type ExecutionInputReader,
  type InputKind,
  type Job,
} from "@quorem/execution";
import { spoolInput } from "../checkpoints/input-spool.ts";
import { dockerSandbox } from "../sandbox/docker.ts";
import { streamedCaseRequest } from "./request-stream.ts";
const job = { jobId: "j", submissionId: "s", attemptId: "a", sandboxScope: "scope" } as Job;
async function fixture(raw: string, kind: InputKind) {
  const bytes = new TextEncoder().encode(raw),
    hash = createHash("sha256").update(bytes).digest("hex");
  const reader = {
    inputPage: async (_job, _kind, _ordinal, offset) => ({
      hash,
      size: bytes.length,
      channel: kind === "case" ? "private" : null,
      bytes: bytes.subarray(offset, offset + 65536),
    }),
  } as ExecutionInputReader;
  return spoolInput({ reader, job, kind, ordinal: 0 });
}
async function text(input: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of input) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}
void test("projects only active Odyssey methods and excludes all expected values", async () => {
  const signature = (methodName: string) => ({
    className: "Solution",
    methodName,
    parameters: [],
    returnType: "int",
  });
  const meta = await fixture(
    JSON.stringify({
      signature: signature("a"),
      statementMarkdown: "x".repeat(180000),
      odyssey: {
        levels: [
          { title: "one", statementMarkdown: "private text", methods: [signature("a")] },
          { title: "two", statementMarkdown: "next", methods: [signature("b")] },
        ],
      },
    }),
    "metadata",
  );
  const source = await fixture("class Solution:\n def a(self): return 7", "source");
  const testcase = await fixture(
    JSON.stringify({ args: [], calls: [{ methodName: "a", args: [], expected: "SECRET" }] }),
    "case",
  );
  try {
    const result = await streamedCaseRequest({
      source,
      metadata: meta,
      testcase,
      level: 1,
      operation: "direct",
      language: "python",
    });
    const wire = await text(result.input.open()),
      parsed = JSON.parse(wire);
    assert.deepEqual(Object.keys(parsed.methods), ["a"]);
    assert.doesNotMatch(wire, /SECRET|private text|next/);
    assert.equal(parsed.calls[0].methodName, "a");
  } finally {
    await Promise.all([source.dispose(), meta.dispose(), testcase.dispose()]);
  }
});
void test(
  "real Docker executes a streamed source, metadata and large projected case",
  { skip: !process.env.QUOREM_TEST_DOCKER_SOCKET, timeout: 60000 },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "quorem-stream-request-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: process.env.QUOREM_TEST_DOCKER_SOCKET!,
      stateRoot: root,
      namespace: "request-stream",
      cleanupMs: 10000,
    });
    const source = await fixture("class Solution:\n def f(self,x): return len(x)", "source");
    const metadata = await fixture(
      JSON.stringify({
        signature: {
          className: "Solution",
          methodName: "f",
          parameters: [{ name: "x", type: "str" }],
          returnType: "int",
        },
        statementMarkdown: "x".repeat(180000),
      }),
      "metadata",
    );
    const testcase = await fixture(
      JSON.stringify({ args: ["λ".repeat(90000)], expected: "SECRET-EXPECTED" }),
      "case",
    );
    try {
      const result = await streamedCaseRequest({
        source,
        metadata,
        testcase,
        level: null,
        operation: "direct",
        language: "python",
      });
      assert.doesNotMatch(await text(result.input.open()), /SECRET-EXPECTED/);
      const fence = { attemptId: randomUUID(), sandboxScope: sandbox.scope };
      const output = await sandbox.runCase({
        fence,
        binding: "a".repeat(64),
        ordinal: 0,
        language: "python",
        limits: defaultLimits(),
        input: result.input,
        outputLimit: 65536,
        timeoutMs: 30000,
      });
      assert.equal(JSON.parse(new TextDecoder().decode(output.stdout).slice(1)).actual, 90000);
      await sandbox.teardownAttempt(fence);
    } finally {
      await Promise.all([source.dispose(), metadata.dispose(), testcase.dispose()]);
    }
  },
);
void test("derives comparison policy from a large signature without retaining documentation", async () => {
  const { metadataSpans } = await import("./metadata-spans.ts");
  const { signaturePolicy } = await import("@quorem/questions");
  const raw = JSON.stringify({
    signature: {
      className: "Solution",
      methodName: "f",
      parameters: [],
      returnType: "list<int>",
      outputOrder: "unordered",
      description: "x".repeat(500000),
    },
    odyssey: {
      levels: [
        {
          title: "one",
          statementMarkdown: "x".repeat(500000),
          methods: [
            {
              className: "Solution",
              methodName: "go",
              parameters: [],
              returnType: "str",
              description: "y".repeat(500000),
            },
          ],
        },
      ],
    },
  });
  const spool = await fixture(raw, "metadata");
  try {
    const spans = await metadataSpans(spool, 1);
    assert.deepEqual(await signaturePolicy(spool, spans.signature), {
      returnType: "list<int>",
      outputOrder: "unordered",
    });
    assert.deepEqual(await signaturePolicy(spool, spans.methods[0].span, true), {
      returnType: "str",
      outputOrder: "ordered",
    });
  } finally {
    await spool.dispose();
  }
});
