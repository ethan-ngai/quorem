/** @file cleanup.test.ts @description Recovery after transient Docker teardown failures. @module language */
import assert from "node:assert/strict";
import test from "node:test";
import { retryableCleanup } from "./cleanup.ts";

void test("failed teardown can recover; concurrent callers share cleanup", async () => {
  let attempts = 0;
  const cleanup = retryableCleanup(async () => {
    if (++attempts === 1) throw new Error("Docker temporarily unavailable");
  });
  const first = cleanup();
  assert.equal(cleanup(), first);
  await assert.rejects(first, /Docker temporarily unavailable/);
  const retry = cleanup();
  assert.equal(cleanup(), retry);
  await retry;
  await cleanup();
  assert.equal(attempts, 2);
});
