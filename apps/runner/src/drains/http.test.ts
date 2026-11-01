import assert from "node:assert/strict";
import { test } from "node:test";
import { drainHandler } from "./http.ts";
import type { DrainState } from "./drain.ts";
const secret = "fixture-drain-secret-1234567890123456";
const request = (signal?: AbortSignal) =>
  new Request("http://localhost/internal/drain", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal,
  });

void test("background attempt survives caller cancellation, never overlaps, confirms current queue", async () => {
  const shutdown = new AbortController();
  let finish!: (state: DrainState) => void;
  let live!: AbortSignal;
  let calls = 0;
  let refreshes = 0;
  let queued = 1;
  const handler = drainHandler({
    secret,
    background: { signal: shutdown.signal, state: async () => ({ queued, running: 0 }) },
    drainer: {
      refresh() {
        refreshes++;
      },
      drain(signal) {
        calls++;
        live = signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  });
  const caller = new AbortController();
  assert.equal((await handler(request(caller.signal))).status, 202);
  caller.abort();
  assert.equal(live.aborted, false);
  assert.equal((await handler(request())).status, 202);
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
  finish({ queued: 0, running: 0, complete: true });
  await handler.settled();
  // A completed drain cannot acknowledge work admitted since its empty confirmation.
  assert.equal((await handler(request())).status, 202);
  assert.equal(calls, 2);
  queued = 0;
  finish({ queued: 0, running: 0, complete: true });
  await handler.settled();
  assert.equal((await handler(request())).status, 200);
});

void test("process shutdown aborts work and joins its cleanup; next poll reports bounded failure", async () => {
  const shutdown = new AbortController();
  let cleanup!: () => void;
  let cancelled = false;
  const handler = drainHandler({
    secret,
    background: { signal: shutdown.signal, state: async () => ({ queued: 0, running: 1 }) },
    drainer: {
      refresh() {},
      drain(signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cancelled = true;
              cleanup = () => reject(new Error("private failure detail"));
            },
            { once: true },
          );
        });
      },
    },
  });
  assert.equal((await handler(request())).status, 202);
  shutdown.abort();
  assert.equal(cancelled, true);
  let joined = false;
  const joining = handler.settled().then(() => {
    joined = true;
  });
  await Promise.resolve();
  assert.equal(joined, false);
  cleanup();
  await joining;
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private failure detail/);
});

void test("queue authority failure returns unavailable without starting work", async () => {
  let calls = 0;
  const handler = drainHandler({
    secret,
    background: {
      signal: new AbortController().signal,
      state: async () => {
        throw new Error("private");
      },
    },
    drainer: {
      refresh() {},
      async drain() {
        calls++;
        return { queued: 0, running: 0, complete: true };
      },
    },
  });
  assert.equal((await handler(request())).status, 503);
  assert.equal(calls, 0);
});
