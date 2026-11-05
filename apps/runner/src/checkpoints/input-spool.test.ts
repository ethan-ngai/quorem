/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { ExecutionInputReader, Job } from "@quorem/execution";
import { spoolInput } from "./input-spool.ts";
const job = { jobId: "j", submissionId: "s", attemptId: "a", sandboxScope: "scope" } as Job;
async function chunks(stream: AsyncIterable<Uint8Array>) {
  const values: Uint8Array[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
void test("verified paged input is spooled before it can be read", async () => {
  const value = new TextEncoder().encode(`"${"x".repeat(200000)}\\u0000"`),
    hash = createHash("sha256").update(value).digest("hex");
  let calls = 0;
  const reader = {
    inputPage: async (_job, _kind, _ordinal, offset) => {
      calls++;
      return {
        hash,
        size: value.length,
        channel: "private",
        bytes: value.subarray(offset, offset + 65536),
      };
    },
  } as ExecutionInputReader;
  const input = await spoolInput({ reader, job, kind: "case", ordinal: 0 });
  assert.equal(calls, 4);
  const chunks: Uint8Array[] = [];
  for await (const chunk of input.stream()) chunks.push(chunk as Uint8Array);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(value));
  await input.dispose();
  assert.throws(() => input.stream());
});
void test("changed page identity, digest or stale lease never exposes data", async () => {
  const value = new Uint8Array(70000).fill(7),
    hash = createHash("sha256").update(value).digest("hex");
  for (const mode of ["identity", "digest", "lease"] as const) {
    const reader = {
      inputPage: async (_job, _kind, _ordinal, offset) => {
        if (mode === "lease" && offset) throw new Error("lease lost");
        const bytes = value.slice(offset, offset + 65536);
        if (mode === "digest" && offset) bytes[0] ^= 1;
        return {
          hash: mode === "identity" && offset ? "a".repeat(64) : hash,
          size: value.length,
          channel: "private",
          bytes,
        };
      },
    } as ExecutionInputReader;
    await assert.rejects(spoolInput({ reader, job, kind: "case", ordinal: 0 }));
  }
});

void test("one-page inputs preserve verified snapshots, spans and disposal at the disk boundary", async () => {
  for (const size of [0, 1, 65536, 65537]) {
    const value = Buffer.alloc(size, 7),
      original = Buffer.from(value);
    const hash = createHash("sha256").update(value).digest("hex");
    const reader = {
      inputPage: async (_job: Job, _kind: string, _ordinal: number, offset: number) => ({
        hash,
        size,
        channel: null,
        bytes: value.subarray(offset, offset + 65536),
      }),
    } as unknown as ExecutionInputReader;
    const input = await spoolInput({ reader, job, kind: "source", ordinal: 0 });
    value.fill(9);
    assert.deepEqual(
      await chunks(input.stream()).then((values) => Buffer.concat(values)),
      original,
    );
    const start = Math.min(1, size),
      length = Math.min(10, size - start);
    const parts = await chunks(input.stream(start, length));
    assert.deepEqual(Buffer.concat(parts), original.subarray(start, start + length));
    for (const chunk of parts) chunk.fill(0);
    assert.deepEqual(
      await chunks(input.stream()).then((values) => Buffer.concat(values)),
      original,
    );
    assert.throws(() => input.stream(size + 1), /Invalid input span/);
    await input.dispose();
    await input.dispose();
    assert.throws(() => input.stream(), /closed/);
  }
});
void test("one-page digest or expected identity mismatch never exposes data", async () => {
  const bytes = Buffer.from("input");
  const reader = {
    inputPage: async () => ({ hash: "0".repeat(64), size: bytes.length, channel: null, bytes }),
  } as unknown as ExecutionInputReader;
  await assert.rejects(spoolInput({ reader, job, kind: "source", ordinal: 0 }), /digest mismatch/);
  await assert.rejects(
    spoolInput({
      reader,
      job,
      kind: "source",
      ordinal: 0,
      expected: { size: 1, hash: "1".repeat(64) },
    }),
    /Inconsistent/,
  );
});
