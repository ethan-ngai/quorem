import assert from "node:assert/strict";
import { test } from "node:test";
import { claimNext } from "./claim.ts";
void test("only claims after exact teardown; notifications cannot select a job", async () => {
  const order: string[] = [];
  const proof = { attemptId: "attempt", sandboxScope: "scope" };
  const authority = {
    nextExpiredAttempt: async () => {
      order.push("candidate");
      return proof;
    },
    claimAfterTeardown: async (_r: boolean, _s: string, p: typeof proof | null) => {
      assert.deepEqual(p, proof);
      order.push("claim");
      return null;
    },
  };
  await claimNext(
    authority,
    {
      teardownAttempt: async (value) => {
        assert.deepEqual(value, proof);
        order.push("teardown");
      },
    },
    { resumable: true, scope: "scope" },
  );
  assert.deepEqual(order, ["candidate", "teardown", "claim"]);
  order.length = 0;
  await assert.rejects(
    claimNext(
      authority,
      {
        teardownAttempt: async () => {
          throw new Error("unconfirmed");
        },
      },
      { resumable: true, scope: "scope" },
    ),
    /unconfirmed/,
  );
  assert.deepEqual(order, ["candidate"]);
});
