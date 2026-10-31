import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecutionRepository, Job } from "@quorem/execution";
import { finishAfterTeardown, yieldAfterTeardown } from "./finish.ts";
void test("terminal and yield commands require completed exact teardown", async () => {
  const job = { attemptId: "attempt", sandboxScope: "scope" } as Job,
    order: string[] = [];
  const repository = {
    finishCompletionStream: async () => {
      order.push("eof");
    },
    promoteCompletion: async () => {
      order.push("promote");
    },
    yield: async () => {
      order.push("yield");
    },
  } as unknown as ExecutionRepository;
  const sandbox = {
    teardownAttempt: async (fence: { attemptId: string; sandboxScope: string }) => {
      assert.deepEqual(fence, { attemptId: "attempt", sandboxScope: "scope" });
      order.push("teardown");
    },
  };
  await finishAfterTeardown(repository, sandbox, job);
  assert.deepEqual(order, ["teardown", "eof", "promote"]);
  order.length = 0;
  await assert.rejects(
    yieldAfterTeardown(
      repository,
      {
        teardownAttempt: async () => {
          throw new Error("unconfirmed");
        },
      },
      job,
    ),
    /unconfirmed/,
  );
  assert.deepEqual(order, []);
});
