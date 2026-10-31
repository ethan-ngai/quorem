/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecutionRepository, Job, SandboxControl } from "@quorem/execution";
import { runAttempt, type CancellationSource } from "./attempt.ts";
const job = { jobId: "j", submissionId: "s", attemptId: "a", sandboxScope: "scope" } as Job;
function fixture() {
  const events: string[] = [];
  let alive = true,
    wake: (() => void) | undefined;
  const repository = {
    lease: async (_job: Job, heartbeat: boolean) => {
      events.push(heartbeat ? "heartbeat" : "lease");
      return alive;
    },
    finishCompletionStream: async () => {
      events.push("eof");
    },
    promoteCompletion: async () => {
      events.push("promote");
    },
    yield: async () => {
      events.push("yield");
    },
  } as unknown as ExecutionRepository;
  const sandbox = {
    teardownAttempt: async () => {
      events.push("teardown");
    },
  } as SandboxControl;
  const cancellations: CancellationSource = {
    subscribe: async () => ({
      next: async (signal) =>
        new Promise((resolve, reject) => {
          wake = () => resolve("changed");
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      close: async () => {},
    }),
  };
  return {
    events,
    repository,
    sandbox,
    cancellations,
    revoke: () => {
      alive = false;
      wake?.();
    },
  };
}
void test("completion and yield publish only after teardown", async () => {
  for (const outcome of ["complete", "yield"] as const) {
    const f = fixture();
    assert.equal(
      await runAttempt({ ...f, job, engine: { execute: async () => outcome } }),
      outcome,
    );
    assert.deepEqual(
      f.events,
      outcome === "complete"
        ? ["lease", "teardown", "eof", "promote"]
        : ["lease", "teardown", "yield"],
    );
  }
});
void test("revoked lease aborts execution and cannot publish", async () => {
  const f = fixture();
  const running = runAttempt({
    ...f,
    job,
    engine: {
      execute: async (_job, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return "complete";
      },
    },
  });
  await sleep(10);
  f.revoke();
  await assert.rejects(running);
  assert.deepEqual(f.events, ["lease", "lease", "teardown"]);
});
void test("heartbeat failure cancels execution and teardown failure cannot publish", async () => {
  const f = fixture();
  f.repository.lease = async (_job, heartbeat) => !heartbeat;
  f.sandbox.teardownAttempt = async () => {
    throw new Error("unconfirmed");
  };
  await assert.rejects(
    runAttempt({
      ...f,
      job,
      heartbeatMs: 1,
      engine: {
        execute: async (_job, signal) => {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          return "complete";
        },
      },
    }),
    /unconfirmed/,
  );
  assert.ok(!f.events.includes("promote"));
});
