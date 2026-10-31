/** @file stream.test.ts @description Pull and cancellation guarantees for result streams. @module judging */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { jsonStream } from "./stream.ts";

void test("respects backpressure and closes the producer on cancellation", async () => {
  let produced = 0,
    closed = false;
  async function* chunks() {
    try {
      while (true) {
        produced++;
        yield String(produced);
      }
    } finally {
      closed = true;
    }
  }
  const reader = jsonStream(chunks()).getReader();
  assert.equal(produced, 0);
  assert.equal(new TextDecoder().decode((await reader.read()).value), "1");
  assert.equal(produced, 1);
  await reader.cancel();
  assert.equal(closed, true);
  assert.equal(produced, 1);
});
void test("propagates a producer failure instead of returning truncated success", async () => {
  async function* chunks() {
    yield "{";
    throw new Error("database lost");
  }
  const reader = jsonStream(chunks()).getReader();
  await reader.read();
  await assert.rejects(reader.read(), /database lost/);
});
