import assert from "node:assert/strict";
import { test } from "node:test";
import { rolloutPauseOperation } from "./hono-production-private-workers.mjs";

void test("explicit repair adopts only the deployed release's existing pause fence", () => {
  const prior = "a".repeat(40),
    next = "b".repeat(40);
  const oldOperation = rolloutPauseOperation(prior, prior, { paused: false }, false);
  const newOperation = rolloutPauseOperation(next, prior, { paused: false }, false);
  const paused = { paused: true, pauseOperation: oldOperation };
  assert.notEqual(oldOperation, newOperation);
  assert.equal(rolloutPauseOperation(next, prior, paused, false), newOperation);
  assert.equal(rolloutPauseOperation(next, prior, paused, true), oldOperation);
  assert.equal(
    rolloutPauseOperation(next, prior, { ...paused, paused: false }, true),
    newOperation,
  );
  assert.equal(
    rolloutPauseOperation(next, prior, { paused: true, pauseOperation: crypto.randomUUID() }, true),
    newOperation,
  );
  assert.equal(rolloutPauseOperation(next, "c".repeat(40), paused, true), newOperation);
});
