/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeWakes, type WakeDelivery } from "./continuous.ts";
void test("incomplete delivery publishes continuation before acknowledgement", async () => {
  const events: string[] = [],
    stop = new AbortController();
  const delivery: WakeDelivery = {
    continue: async () => {
      events.push("continue");
    },
    acknowledge: async () => {
      events.push("ack");
      stop.abort();
    },
    retry: async () => {
      events.push("retry");
      stop.abort();
    },
  };
  await consumeWakes({
    signal: stop.signal,
    source: { receive: async () => delivery },
    drainer: { refresh() {}, drain: async () => ({ queued: 1, running: 0, complete: false }) },
  });
  assert.deepEqual(events, ["continue", "ack"]);
});
void test("failed continuation retries the original delivery", async () => {
  const events: string[] = [],
    stop = new AbortController();
  const delivery: WakeDelivery = {
    continue: async () => {
      events.push("continue");
      throw new Error("unavailable");
    },
    acknowledge: async () => {
      events.push("ack");
    },
    retry: async () => {
      events.push("retry");
      stop.abort();
    },
  };
  await consumeWakes({
    signal: stop.signal,
    source: { receive: async () => delivery },
    drainer: { refresh() {}, drain: async () => ({ queued: 1, running: 0, complete: false }) },
  });
  assert.deepEqual(events, ["continue", "retry"]);
});
