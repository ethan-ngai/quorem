/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { ExecutionInputReader, Job } from "@quorem/execution";
import { spoolInput } from "./input-spool.ts";
const job = { jobId: "j", submissionId: "s", attemptId: "a", sandboxScope: "scope" } as Job;
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
