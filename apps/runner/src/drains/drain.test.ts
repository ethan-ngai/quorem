/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExecutionRepository, Job, SandboxControl } from "@quorem/execution";
import { drainer, type QueueSignals } from "./drain.ts";
import type { CancellationSource } from "../orchestration/attempt.ts";
import { drainHandler } from "./http.ts";

function fixture() {
  let queued = 0,
    claimed = 0,
    notified: (() => void) | undefined;
  const job = { jobId: "j", submissionId: "s", attemptId: "a", sandboxScope: "fixture" } as Job;
  const repository = {
    nextExpiredAttempt: async () => null,
    claimAfterTeardown: async () => {
      if (!queued) return null;
      queued--;
      claimed++;
      return job;
    },
    lease: async () => true,
    finishCompletionStream: async () => {},
    promoteCompletion: async () => {},
  } as unknown as ExecutionRepository;
  const sandbox = { scope: "fixture", teardownAttempt: async () => {} } as SandboxControl & {
    scope: string;
  };
  const pending = (signal: AbortSignal) =>
    new Promise<"changed">((resolve, reject) => {
      notified = () => resolve("changed");
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const queue: QueueSignals = {
    subscribe: async () => ({ next: pending, close: async () => {} }),
    state: async () => ({ queued, running: 0 }),
    confirmEmpty: async () => !queued,
    nextDeadline: async () => (queued ? 0 : null),
  };
  const cancellations: CancellationSource = {
    subscribe: async () => ({
      next: pending,
      close: async () => {},
    }),
  };
  const add = () => {
    queued++;
    notified?.();
  };
  return { repository, sandbox, queue, cancellations, add, count: () => claimed };
}
void test("pre-admission wake waits for committed work and confirms empty", async () => {
  const f = fixture();
  const d = drainer({
    ...f,
    slots: 1,
    resumable: true,
    graceMs: 35,
    claimWindowMs: 100,
    engine: { execute: async () => "complete" },
  });
  const result = d.drain(AbortSignal.timeout(500));
  await sleep(10);
  f.add();
  assert.equal((await result).complete, true);
  assert.equal(f.count(), 1);
});
void test("bounded drain returns incomplete when work cannot be claimed", async () => {
  const f = fixture();
  f.add();
  f.repository.claimAfterTeardown = async () => null;
  const d = drainer({
    ...f,
    slots: 1,
    resumable: true,
    graceMs: 10,
    claimWindowMs: 25,
    engine: { execute: async () => "complete" },
  });
  assert.equal((await d.drain(AbortSignal.timeout(500))).complete, false);
});
void test("HTTP authenticates and overlaps require continuation", async () => {
  let finish!: () => void,
    refreshed = 0;
  const service = {
    refresh: () => {
      refreshed++;
    },
    drain: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { queued: 0, running: 0, complete: true };
    },
  };
  const handler = drainHandler({ drainer: service, secret: "x".repeat(32) });
  const request = () =>
    new Request("http://localhost/internal/drain", {
      method: "POST",
      headers: { authorization: `Bearer ${"x".repeat(32)}` },
    });
  assert.equal(
    (await handler(new Request("http://localhost/internal/drain", { method: "POST" }))).status,
    401,
  );
  const first = handler(request());
  assert.equal((await handler(request())).status, 202);
  finish();
  assert.equal((await first).status, 200);
  assert.equal(refreshed, 2);
});
void test("shutdown reports unconfirmed teardown while leaving the attempt fenced", async () => {
  const { UnconfirmedTeardown } = await import("../sandbox/types.ts");
  const f = fixture();
  f.add();
  let started!: () => void;
  const executing = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.sandbox.teardownAttempt = async () => {
    throw new UnconfirmedTeardown();
  };
  const d = drainer({
    ...f,
    slots: 1,
    resumable: true,
    graceMs: 10,
    claimWindowMs: 1000,
    engine: {
      execute: async (_job, signal) => {
        started();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
        return "complete";
      },
    },
  });
  const stop = new AbortController(),
    pending = d.drain(stop.signal);
  await executing;
  stop.abort();
  await assert.rejects(pending, UnconfirmedTeardown);
});
