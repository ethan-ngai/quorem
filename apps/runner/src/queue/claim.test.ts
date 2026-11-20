import assert from "node:assert/strict";
import { test } from "node:test";
import { claimNext } from "./claim.ts";
import { UnconfirmedTeardown } from "../sandbox/types.ts";
void test("only claims after exact teardown; notifications cannot select a job", async () => {
  const order: string[] = [];
  const proof = { attemptId: "attempt", sandboxScope: "scope" };
  const authority = {
    quarantineAttempt: async () => assert.fail("unexpected quarantine"),
    reserveExpiredAttempt: async () => {
      order.push("candidate");
      return proof;
    },
    claimAfterTeardown: async (_r: boolean, _s: string, p: typeof proof | null) => {
      assert.deepEqual(p, proof);
      order.push("claim");
      return { ...proof } as Awaited<ReturnType<typeof claimNext>>;
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

void test("failed recovery backs off the exact attempt and claims fresh work", async () => {
  const fence = { attemptId: "expired", sandboxScope: "scope" };
  const fresh = { attemptId: "fresh", sandboxScope: "scope" } as NonNullable<
    Awaited<ReturnType<typeof claimNext>>
  >;
  const calls: string[] = [];
  const result = await claimNext(
    {
      reserveExpiredAttempt: async () => fence,
      quarantineAttempt: async (attempt) => {
        assert.deepEqual(attempt, fence);
        calls.push("quarantine");
      },
      claimAfterTeardown: async (_resumable, _scope, proof) => {
        assert.equal(proof, null);
        calls.push("claim fresh");
        return fresh;
      },
    },
    {
      teardownAttempt: async () => {
        throw new UnconfirmedTeardown();
      },
    },
    { resumable: true, scope: "scope" },
  );
  assert.equal(result, fresh);
  assert.deepEqual(calls, ["quarantine", "claim fresh"]);
});
