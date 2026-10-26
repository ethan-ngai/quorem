/** Run against wrangler.test.jsonc; exercises the actual workerd/Docker upgrade bridge. */
import assert from "node:assert/strict";
const base = process.env.QUOREM_WORKER_TEST_ORIGIN || "http://localhost:8791";
const sockets = [];
const message = (socket, value) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket echo timed out")), 10_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(event.data);
      },
      { once: true },
    );
    socket.send(value);
  });
try {
  const response = await fetch(base + "/health");
  assert.equal(response.status, 200);
  const unsafe = await fetch(base + "/internal/judge/wake", { method: "POST", body: "{}" });
  assert.equal(unsafe.status, 404);
  const wake = await fetch(base + "/internal/judge/wake", {
    method: "POST",
    headers: { Authorization: "Bearer local-contract-fixture-token-at-least-32-chars" },
    body: JSON.stringify({ jobId: "fixture-job-123456" }),
  });
  assert.equal(wake.status, 202);
  const instances = new Set();
  for (let index = 0; index < 5; index++) {
    const socket = new WebSocket(
      base.replace(/^http/, "ws") + "/v1/interviews/00000000-0000-4000-8000-000000000001/events",
      ["quorem"],
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket upgrade timed out")), 60_000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("WebSocket upgrade failed"));
        },
        { once: true },
      );
    });
    assert.equal(socket.protocol, "quorem");
    sockets.push(socket);
    instances.add(await message(socket, "instance"));
    assert.equal(await message(socket, "echo-" + index), "echo-" + index);
  }
  assert.ok(instances.size >= 2, "Socket pressure did not activate another instance");
  // Exceed the 45s lease lifetime: live sockets must renew without dropping or occupying stale capacity.
  await new Promise((resolve) => setTimeout(resolve, 50_000));
  for (const socket of sockets)
    assert.equal(await message(socket, "after-lease-renewal"), "after-lease-renewal");
  console.log(
    "workerd: HTTP, authenticated durable wake, accepted WebSocket echo/subprotocol, pressure scale-out and 50s live-lease renewal passed",
  );
} finally {
  for (const socket of sockets) socket.close();
}
