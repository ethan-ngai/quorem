/** Exercise production ingress and AppPool in workerd without starting Docker. */
import assert from "node:assert/strict";
const base = process.env.QUOREM_ROUTING_TEST_ORIGIN || "http://localhost:8792";
const response = await fetch(base + "/v1/problems");
assert.equal(response.status, 200);
const first = await response.json();
const cookies = response.headers.getSetCookie();
assert.equal(cookies.length, 3);
assert.ok(cookies.some((value) => value.startsWith("session=")));
assert.ok(cookies.some((value) => value.startsWith("csrf=")));
const route = cookies.find((value) => value.startsWith("__Host-quorem-route="));
assert.match(route, /Max-Age=600;/);
for (let index = 0; index < 4; index++) {
  const next = await fetch(base + "/v1/problems", { headers: { Cookie: route.split(";", 1)[0] } });
  assert.equal((await next.json()).instance, first.instance);
}
const socket = new WebSocket(
  base.replace(/^http/, "ws") + "/v1/interviews/00000000-0000-4000-8000-000000000001/events",
  ["quorem"],
);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("workerd upgrade timed out")), 10_000);
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
        reject(new Error("workerd upgrade failed"));
      },
      { once: true },
    );
  });
  assert.equal(socket.protocol, "quorem");
  const echo = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("workerd echo timed out")), 10_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(event.data);
      },
      { once: true },
    );
  });
  socket.send("affinity-upgrade");
  assert.equal(await echo, "affinity-upgrade");
  console.log("workerd: warm HTTP affinity, auth cookies and native 101/subprotocol/echo passed");
} finally {
  socket.close();
}
