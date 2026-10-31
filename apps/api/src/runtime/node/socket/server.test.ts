/** @file server.test.ts @description Upgrade cancellation and transport safety. @module events */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { installNodeSockets } from "./server.ts";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
void test("rejects untrusted origins and releases a late upgrade lease", async () => {
  let called = 0,
    released = 0;
  const server = createServer();
  const stop = installNodeSockets(server, {
    origins: ["https://example.test"],
    resolve: async () => {
      called++;
      await delay(100);
      return {
        mode: "invite",
        security: { verify: async () => ({ binding: "opaque" }), authorize: async () => "invite" },
        subscription: { subscribe: async () => () => {} },
        release: async () => {
          released++;
        },
      };
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const url = `ws://127.0.0.1:${addr.port}`;
  try {
    const denied = new WebSocket(url, ["quorem"], { headers: { Origin: "https://evil.test" } });
    denied.on("error", () => {});
    await new Promise<void>((resolve) => denied.once("close", () => resolve()));
    assert.equal(called, 0);
    const pending = new WebSocket(url, ["quorem"], { headers: { Origin: "https://example.test" } });
    pending.on("error", () => {});
    await delay(20);
    pending.terminate();
    await new Promise<void>((resolve) => pending.once("close", () => resolve()));
    await delay(150);
    assert.equal(called, 1);
    assert.equal(released, 1);
  } finally {
    await stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
