import { test } from "node:test";
import assert from "node:assert/strict";
import { AppPool, Judge, Quorem } from "./router.js";
import { ContainerLifecycle } from "./container.js";
import { APP_IDLE_MS, SOCKET_LEASE_MS, chooseInstance, isSocketRequest, limits } from "./policy.js";
import worker from "./worker.js";

const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function context(entries = []) {
  const data = new Map(entries);
  const ctx = {
    storage: {
      async list() {
        return new Map(data);
      },
      async put(key, value) {
        data.set(key, structuredClone(value));
      },
      async delete(key) {
        data.delete(key);
      },
      async setAlarm(at) {
        ctx.alarmAt = at;
      },
      async deleteAlarm() {
        ctx.alarmAt = undefined;
      },
    },
    blockConcurrencyWhile(run) {
      ctx.loaded = run();
    },
    waitUntil(promise) {
      promise.catch(() => {});
    },
    container: {
      running: true,
      starts: 0,
      destroyed: 0,
      start() {
        this.running = true;
        this.starts++;
      },
      async setInactivityTimeout(ms) {
        this.idle = ms;
      },
      async destroy() {
        this.running = false;
        this.destroyed++;
      },
      monitor() {
        return new Promise(() => {});
      },
    },
  };
  return { ctx, data };
}
const env = {
  APP_RUNTIME_ENV: "{}",
  JUDGE_RUNTIME_ENV: "{}",
  JUDGE_CONTROL_TOKEN: "test-control-token-at-least-32-chars",
  APP_ORIGIN: "https://quorem.test",
};

test("independent HTTP/socket pressure packs existing instances; stale leases free capacity", () => {
  const cap = { instances: 2, http: 2, sockets: 4 };
  const leases = new Map([
    ["a", { slot: 0, kind: "http", expires: 100 }],
    ["b", { slot: 0, kind: "sockets", expires: 100 }],
  ]);
  assert.equal(chooseInstance(leases, "sockets", cap, 0), 0);
  assert.equal(chooseInstance(leases, "http", cap, 0), 0);
  leases.set("c", { slot: 0, kind: "http", expires: 100 });
  assert.equal(chooseInstance(leases, "http", cap, 0), 1);
  assert.equal(chooseInstance(leases, "http", cap, 101), 0);
  assert.throws(() => limits({ APP_POOL_SHARDS: 0 }));
});

test("pool reservations survive reload and streaming completion releases exact capacity", async () => {
  const { ctx, data } = context();
  const pending = [];
  const configuration = {
    ...env,
    APP_HTTP_CAPACITY: "2",
    APP_INSTANCES_PER_SHARD: "2",
    APPS: {
      getByName(name) {
        return {
          fetch: async () => {
            const wait = deferred();
            pending.push({ name, wait });
            return wait.promise;
          },
        };
      },
    },
  };
  const pool = new AppPool(ctx, configuration);
  await ctx.loaded;
  const requests = Array.from({ length: 4 }, () =>
    pool.fetch(new Request("https://quorem.test/v1/action", { headers: { "x-quorem-pool": "3" } })),
  );
  await turn();
  assert.deepEqual(
    pending.map((entry) => entry.name),
    ["app-3-0", "app-3-0", "app-3-1", "app-3-1"],
  );
  const full = await pool.fetch(
    new Request("https://quorem.test/v1/action", { headers: { "x-quorem-pool": "3" } }),
  );
  assert.equal(full.headers.get("X-Quorem-Capacity"), "full");
  const restored = context([...data]);
  const reloaded = new AppPool(restored.ctx, configuration);
  await restored.ctx.loaded;
  assert.equal(reloaded.leases.size, 4);
  for (const entry of pending) entry.wait.resolve(new Response("done"));
  await Promise.all((await Promise.all(requests)).map((response) => response.text()));
  await turn();
  assert.equal(pool.leases.size, 0);
  assert.equal(data.size, 0);
});

test("socket reservations renew and a crashed socket reservation expires", async () => {
  const id = "socket-id";
  const lease = { slot: 0, kind: "sockets", expires: Date.now() + 500 };
  const { ctx, data } = context([
    ["lease:" + id, lease],
    ["lease:expired", { ...lease, expires: 0 }],
  ]);
  const pool = new AppPool(ctx, env);
  await ctx.loaded;
  assert.equal(pool.leases.size, 1);
  const response = await pool.fetch(
    new Request("https://pool/__leases", { method: "POST", body: JSON.stringify({ renew: [id] }) }),
  );
  assert.equal(response.status, 204);
  assert.ok(data.get("lease:" + id).expires >= Date.now() + SOCKET_LEASE_MS - 50);
  await pool.fetch(
    new Request("https://pool/__leases", {
      method: "POST",
      body: JSON.stringify({ release: [id] }),
    }),
  );
  assert.equal(pool.leases.size, 0);
});

test("concurrent cold requests share readiness; warm failures never replay mutating requests", async () => {
  const { ctx } = context();
  ctx.container.running = false;
  let health = 0,
    commands = 0;
  const ready = deferred();
  ctx.container.getTcpPort = () => ({
    async fetch(request) {
      if (new URL(typeof request === "string" ? request : request.url).pathname === "/health") {
        health++;
        await ready.promise;
        return new Response("ok");
      }
      commands++;
      return new Response("busy", { status: 503 });
    },
  });
  const lifecycle = new ContainerLifecycle(ctx, {}, 8088);
  const one = lifecycle.forward(
    new Request("https://app/v1/submit", { method: "POST", body: "one" }),
  );
  const two = lifecycle.forward(
    new Request("https://app/v1/submit", { method: "POST", body: "two" }),
  );
  await turn();
  assert.equal(health, 1);
  assert.equal(ctx.container.starts, 1);
  ready.resolve();
  await Promise.all([one, two]);
  await lifecycle.forward(new Request("https://app/v1/submit", { method: "POST", body: "three" }));
  assert.equal(health, 1);
  assert.equal(commands, 3);
});

test("new judge arrival during drain waits for a subsequent generation", async () => {
  const { ctx } = context();
  const judge = new Judge(ctx, env);
  const drains = [];
  judge.lifecycle.ensureReady = async () => {};
  judge.lifecycle.forward = async () => {
    const wait = deferred();
    drains.push(wait);
    return wait.promise;
  };
  const first = judge.fetch(new Request("https://judge/wake", { method: "POST" }));
  await turn();
  const second = judge.fetch(new Request("https://judge/wake", { method: "POST" }));
  let secondFinished = false;
  void second.then(() => {
    secondFinished = true;
  });
  drains[0].resolve(Response.json({ queued: 0, running: 0 }));
  assert.equal((await first).status, 200);
  await turn();
  assert.equal(drains.length, 2);
  assert.equal(secondFinished, false);
  drains[1].resolve(Response.json({ queued: 0, running: 0 }));
  assert.equal((await second).status, 200);
  await judge.alarm();
  assert.equal(ctx.container.destroyed, 1);
});

test("wake authentication and durable queue send precede success", async () => {
  const queued = deferred();
  let sent = 0;
  const configuration = {
    ...env,
    JUDGE_WAKE: {
      send: async (message) => {
        assert.deepEqual(message, { jobId: "job-id-12345" });
        sent++;
        await queued.promise;
      },
    },
  };
  const request = () =>
    new Request("https://quorem.test/internal/judge/wake", {
      method: "POST",
      headers: { Authorization: "Bearer test-control-token-at-least-32-chars" },
      body: JSON.stringify({ jobId: "job-id-12345" }),
    });
  assert.equal(
    (await worker.fetch(new Request(request(), { headers: {} }), configuration)).status,
    404,
  );
  const response = worker.fetch(request(), configuration);
  let finished = false;
  void response.then(() => {
    finished = true;
  });
  await turn();
  assert.equal(sent, 1);
  assert.equal(finished, false);
  queued.resolve();
  assert.equal((await response).status, 202);
  const unsafe = new Request(request(), {
    method: "POST",
    body: JSON.stringify({ jobId: "job-id-12345", source: "private" }),
  });
  assert.equal((await worker.fetch(unsafe, configuration)).status, 400);
});

test("queue only acknowledges a successful authoritative empty drain", async () => {
  for (const [status, body, ack] of [
    [202, { queued: 1, running: 0 }, false],
    [200, { queued: 0, running: 1 }, false],
    [503, {}, false],
    [200, { queued: 0, running: 0 }, true],
  ]) {
    let acknowledged = false,
      retried = false;
    const message = {
      id: "stable-message",
      body: { jobId: "job-id-12345" },
      ack() {
        acknowledged = true;
      },
      retry() {
        retried = true;
      },
    };
    const configuration = {
      ...env,
      JUDGES: {
        getByName(name) {
          assert.match(name, /^judge-[0-7]$/);
          return { fetch: async () => Response.json(body, { status }) };
        },
      },
    };
    await worker.queue({ messages: [message] }, configuration);
    assert.equal(acknowledged, ack);
    assert.equal(retried, !ack);
  }
});

test("idle application reaches zero; an active connection prevents destruction", async () => {
  const { ctx } = context();
  const app = new Quorem(ctx, {
    ...env,
    POOLS: { getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
  });
  app.sockets.set({}, { pool: "0", lease: "active" });
  app.lastActivity = 0;
  await app.alarm();
  assert.equal(ctx.container.destroyed, 0);
  app.sockets.clear();
  app.lastActivity = Date.now() - APP_IDLE_MS - 1;
  await app.alarm();
  assert.equal(ctx.container.destroyed, 1);
});

test("socket saturation retains independently bounded HTTP headroom", () => {
  const cap = { instances: 1, http: 2, sockets: 2 };
  const leases = new Map([
    ["a", { slot: 0, kind: "sockets", expires: 100 }],
    ["b", { slot: 0, kind: "sockets", expires: 100 }],
  ]);
  assert.equal(chooseInstance(leases, "http", cap, 0), 0);
  leases.set("c", { slot: 0, kind: "http", expires: 100 });
  leases.set("d", { slot: 0, kind: "http", expires: 100 });
  assert.equal(chooseInstance(leases, "http", cap, 0), -1);
});

test("a new arrival waits for idle destruction to finish before starting", async () => {
  const { ctx } = context();
  const stopped = deferred();
  ctx.container.destroy = async () => {
    await stopped.promise;
    ctx.container.running = false;
  };
  ctx.container.getTcpPort = () => ({ fetch: async () => new Response("ready") });
  const lifecycle = new ContainerLifecycle(ctx, {}, 8088);
  lifecycle.ready = true;
  const stop = lifecycle.stop();
  const start = lifecycle.ensureReady();
  await turn();
  assert.equal(ctx.container.starts, 0);
  stopped.resolve();
  await Promise.all([stop, start]);
  assert.equal(ctx.container.starts, 1);
  assert.equal(lifecycle.ready, true);
});

test("an established WebSocket has no lingering handshake abort timer", async () => {
  const { ctx } = context();
  let signal;
  ctx.container.getTcpPort = () => ({
    fetch: async (_request, options) => {
      signal = options.signal;
      return { status: 101 };
    },
  });
  const lifecycle = new ContainerLifecycle(ctx, {}, 8088);
  lifecycle.ready = true;
  await lifecycle.forward(
    new Request("https://app/v1/interviews/00000000-0000-4000-8000-000000000001/events", {
      headers: { Upgrade: "websocket", Connection: "upgrade" },
    }),
    5,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
});

test("only supported GET event upgrades consume the socket budget", () => {
  const headers = { Upgrade: "websocket", Connection: "keep-alive, Upgrade" };
  const path = "https://app/v1/interviews/00000000-0000-4000-8000-000000000001/events";
  assert.equal(isSocketRequest(new Request(path, { headers })), true);
  for (const url of ["https://app/v1/submissions", "https://app/api/auth/sign-in/email", path]) {
    assert.equal(isSocketRequest(new Request(url, { method: "POST", headers, body: "{}" })), false);
  }
  assert.equal(isSocketRequest(new Request(path, { headers: { Upgrade: "websocket" } })), false);
});

test("one hundred valid wakes share one authoritative drain and acknowledge together", async () => {
  let calls = 0,
    acknowledged = 0,
    retried = 0;
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `message-${index}`,
    body: { jobId: `job-id-${String(index).padStart(8, "0")}` },
    ack() {
      acknowledged++;
    },
    retry() {
      retried++;
    },
  }));
  await worker.queue(
    { messages },
    {
      ...env,
      JUDGES: {
        getByName() {
          return {
            fetch: async () => {
              calls++;
              return Response.json({ queued: 0, running: 0 });
            },
          };
        },
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(acknowledged, 100);
  assert.equal(retried, 0);
});
