import { test } from "node:test";
import assert from "node:assert/strict";
import { AppPool, Judge, Quorem } from "./router.js";
import { ContainerLifecycle } from "./container.js";
import {
  APP_IDLE_MS,
  ROUTE_COOKIE,
  SOCKET_LEASE_MS,
  chooseInstance,
  isSocketRequest,
  limits,
  preferredShard,
  withShardAffinity,
} from "./policy.js";
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
      async list({ prefix = "" } = {}) {
        return new Map([...data].filter(([key]) => key.startsWith(prefix)));
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

void test("independent HTTP/socket pressure packs existing instances; stale leases free capacity", () => {
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

void test("pool reservations survive reload and streaming completion releases exact capacity", async () => {
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
  assert.equal([...data.keys()].filter((key) => key.startsWith("lease:")).length, 0);
  assert.equal(pool.warmSlots.size, 2);
});

void test("socket reservations renew and a crashed socket reservation expires", async () => {
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

void test("concurrent cold requests share readiness; warm failures never replay mutating requests", async () => {
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

void test("new judge arrival during drain waits for a subsequent generation", async () => {
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

void test("wake authentication and durable queue send precede success", async () => {
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

void test("queue only acknowledges a successful authoritative empty drain", async () => {
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

void test("idle application reaches zero; an active connection prevents destruction", async () => {
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

void test("socket saturation retains independently bounded HTTP headroom", () => {
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

void test("a new arrival waits for idle destruction to finish before starting", async () => {
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

void test("an established WebSocket has no lingering handshake abort timer", async () => {
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

void test("only supported GET event upgrades consume the socket budget", () => {
  const headers = { Upgrade: "websocket", Connection: "keep-alive, Upgrade" };
  const path = "https://app/v1/interviews/00000000-0000-4000-8000-000000000001/events";
  assert.equal(isSocketRequest(new Request(path, { headers })), true);
  assert.equal(
    isSocketRequest(new Request("https://app/v1/memberships/events", { headers })),
    true,
  );
  assert.equal(
    isSocketRequest(new Request("https://app/v1/interviews/current/events", { headers })),
    false,
  );
  for (const url of ["https://app/v1/submissions", "https://app/api/auth/sign-in/email", path]) {
    assert.equal(isSocketRequest(new Request(url, { method: "POST", headers, body: "{}" })), false);
  }
  assert.equal(isSocketRequest(new Request(path, { headers: { Upgrade: "websocket" } })), false);
});

void test("one hundred valid wakes share one authoritative drain and acknowledge together", async () => {
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

void test("parallel first requests coalesce; browser affinity overrides changed client hints", async () => {
  const calls = [];
  const configuration = {
    ...env,
    POOLS: {
      getByName(pool) {
        return {
          fetch: async () => {
            calls.push(pool);
            return new Response("ok");
          },
        };
      },
    },
  };
  const headers = { "CF-Connecting-IP": "192.0.2.10", "User-Agent": "fixture-browser" };
  const request = () => new Request("https://quorem.test/v1/problems", { headers });
  const [first, second] = await Promise.all([
    worker.fetch(request(), configuration),
    worker.fetch(request(), configuration),
  ]);
  assert.equal(calls[0], calls[1]);
  const route = first.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(ROUTE_COOKIE + "="));
  assert.ok(route.includes(`Max-Age=${APP_IDLE_MS / 1000}`));
  assert.match(route, /Path=\/;.*HttpOnly; Secure; SameSite=Lax/);
  const cookie = route.split(";", 1)[0];
  await worker.fetch(
    new Request(request(), { headers: { Cookie: cookie, "CF-Connecting-IP": "198.51.100.9" } }),
    configuration,
  );
  assert.equal(calls[2], calls[0]);
  await first.body.cancel();
  await second.body.cancel();
  assert.equal(
    preferredShard(new Request(request(), { headers: { Cookie: `${ROUTE_COOKIE}=99` } }), 4),
    preferredShard(new Request(request(), { headers: {} }), 4),
  );
});

void test("only pre-dispatch capacity fallback moves affinity; admitted POST failures never replay", async () => {
  const calls = [];
  let rejectCapacity = true;
  const configuration = {
    ...env,
    APP_POOL_SHARDS: "2",
    POOLS: {
      getByName(pool) {
        return {
          fetch: async () => {
            calls.push(pool);
            if (pool === "0" && rejectCapacity)
              return new Response("full", {
                status: 503,
                headers: { "X-Quorem-Capacity": "full" },
              });
            return new Response("admitted", { status: 503 });
          },
        };
      },
    },
  };
  const request = () =>
    new Request("https://quorem.test/v1/submissions", {
      method: "POST",
      body: "once",
      headers: { Cookie: `${ROUTE_COOKIE}=0` },
    });
  const fallback = await worker.fetch(request(), configuration);
  assert.deepEqual(calls, ["0", "1"]);
  assert.match(fallback.headers.get("Set-Cookie"), new RegExp(`${ROUTE_COOKIE}=1;`));
  await fallback.body.cancel();
  calls.length = 0;
  rejectCapacity = false;
  const failed = await worker.fetch(request(), configuration);
  assert.equal(failed.status, 503);
  assert.deepEqual(calls, ["0"]);
  await failed.body.cancel();
});

void test("affinity response preserves auth cookies, WebSocket and subprotocol", () => {
  const headers = new Headers();
  headers.append("Set-Cookie", "session=fixture; HttpOnly; Secure");
  headers.append("Set-Cookie", "csrf=fixture; Secure");
  const regular = withShardAffinity(new Response("body", { headers }), 2);
  assert.equal(regular.headers.getSetCookie().length, 3);
  assert.ok(regular.headers.getSetCookie().some((value) => value.startsWith("session=")));
  assert.ok(regular.headers.getSetCookie().some((value) => value.startsWith("csrf=")));
  const NativeResponse = globalThis.Response;
  const socket = {};
  // Node lacks workerd's 101 Response constructor; assert its upgrade initializer explicitly.
  globalThis.Response = class extends NativeResponse {
    constructor(body, init) {
      super(body, { ...init, status: 200, statusText: "OK" });
      Object.defineProperty(this, "status", { value: init.status });
      this.webSocket = init.webSocket;
    }
  };
  try {
    const upgraded = withShardAffinity(
      {
        body: null,
        status: 101,
        statusText: "Switching Protocols",
        headers: { "Sec-WebSocket-Protocol": "quorem" },
        webSocket: socket,
      },
      1,
    );
    assert.equal(upgraded.status, 101);
    assert.equal(upgraded.webSocket, socket);
    assert.equal(upgraded.headers.get("Sec-WebSocket-Protocol"), "quorem");
    assert.match(upgraded.headers.get("Set-Cookie"), new RegExp(`${ROUTE_COOKIE}=1;`));
  } finally {
    globalThis.Response = NativeResponse;
  }
});

void test("warm available slots survive reload, expire and never bypass capacity", async () => {
  const calls = [];
  const initial = context([
    ["warm:1", Date.now() + APP_IDLE_MS],
    ["warm:0", 0],
    ["warm:99", Date.now() + APP_IDLE_MS],
  ]);
  const configuration = {
    ...env,
    APP_INSTANCES_PER_SHARD: "2",
    APPS: {
      getByName(name) {
        return {
          fetch: async () => {
            calls.push(name);
            return new Response("ok");
          },
        };
      },
    },
  };
  const pool = new AppPool(initial.ctx, configuration);
  await initial.ctx.loaded;
  assert.deepEqual([...pool.warmSlots.keys()], [1]);
  const request = () =>
    new Request("https://quorem.test/v1/problems", { headers: { "x-quorem-pool": "2" } });
  await (await pool.fetch(request())).text();
  await turn();
  assert.equal(calls[0], "app-2-1");
  assert.equal(pool.leases.size, 0);
  const restored = context([...initial.data]);
  const reloaded = new AppPool(restored.ctx, configuration);
  await restored.ctx.loaded;
  await (await reloaded.fetch(request())).text();
  await turn();
  assert.equal(calls[1], "app-2-1");
  reloaded.warmSlots.set(1, 0);
  await reloaded.alarm();
  assert.equal(reloaded.warmSlots.size, 0);
  assert.equal(restored.ctx.alarmAt, undefined);
  await (await reloaded.fetch(request())).text();
  assert.equal(calls[2], "app-2-0");
  const full = new Map([["active", { slot: 1, kind: "http", expires: 100 }]]);
  assert.equal(
    chooseInstance(full, "http", { instances: 2, http: 1, sockets: 1 }, 0, new Map([[1, 100]])),
    0,
  );
});

void test("failed warm dispatch clears its hint without replay; live ready renewals refresh warmth", async () => {
  const calls = [];
  const { ctx, data } = context([["warm:1", Date.now() + APP_IDLE_MS]]);
  const pool = new AppPool(ctx, {
    ...env,
    APPS: {
      getByName(name) {
        return {
          fetch: async () => {
            calls.push(name);
            return new Response("unavailable", { status: 503 });
          },
        };
      },
    },
  });
  await ctx.loaded;
  const failed = await pool.fetch(
    new Request("https://quorem.test/v1/action", {
      method: "POST",
      body: "once",
      headers: { "x-quorem-pool": "0" },
    }),
  );
  await failed.text();
  await turn();
  assert.deepEqual(calls, ["app-0-1"]);
  assert.equal(pool.warmSlots.size, 0);
  await pool.fetch(
    new Request("https://pool/__leases", {
      method: "POST",
      body: JSON.stringify({ renew: [{ id: "live", slot: 1, kind: "sockets", warm: true }] }),
    }),
  );
  assert.ok(data.get("warm:1") >= Date.now() + APP_IDLE_MS - 50);
});

void test("app ten-minute grace and judge two-minute boot grace remain separate", async () => {
  const appContext = context();
  const app = new Quorem(appContext.ctx, env);
  app.lastActivity = Date.now() - 180_000;
  await app.alarm();
  assert.equal(appContext.ctx.container.destroyed, 0);
  app.lastActivity = Date.now() - APP_IDLE_MS - 1;
  await app.alarm();
  assert.equal(appContext.ctx.container.destroyed, 1);
  const judgeContext = context();
  judgeContext.ctx.container.running = false;
  judgeContext.ctx.container.getTcpPort = () => ({ fetch: async () => new Response("ready") });
  const judge = new Judge(judgeContext.ctx, env);
  await judge.lifecycle.ensureReady();
  assert.equal(judge.idleMs, 120_000);
  assert.equal(judgeContext.ctx.container.idle, 120_000);
});

void test("public auth configuration bypasses unavailable application and database capacity", async () => {
  const config = {
    method: "password",
    preferredOrigin: env.APP_ORIGIN,
    passkey: true,
    registration: true,
    providers: ["google", "github"],
  };
  const configuration = {
    ...env,
    AUTH_PUBLIC_CONFIG: JSON.stringify(config),
    POOLS: {
      getByName() {
        throw new Error("No application may start");
      },
    },
  };
  const response = await worker.fetch(
    new Request(`${env.APP_ORIGIN}/api/auth/quorem-config`),
    configuration,
  );
  assert.deepEqual(await response.json(), config);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  assert.equal(response.headers.has("Set-Cookie"), false);
  await assert.rejects(() =>
    worker.fetch(new Request(`${env.APP_ORIGIN}/api/auth/token`), configuration),
  );
});

void test("distinct first-time visitors pack the same shard before capacity fallback", () => {
  for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.4"]) {
    assert.equal(
      preferredShard(
        new Request(env.APP_ORIGIN, {
          headers: { "CF-Connecting-IP": ip, "User-Agent": ip },
        }),
        4,
      ),
      0,
    );
  }
  assert.equal(
    preferredShard(
      new Request(env.APP_ORIGIN, {
        headers: { Cookie: `${ROUTE_COOKIE}=2` },
      }),
      4,
    ),
    2,
  );
});

void test("login configuration returns while background readiness remains pending", async () => {
  const ready = deferred();
  let warmups = 0;
  const pending = [];
  const configuration = {
    ...env,
    AUTH_PUBLIC_CONFIG: JSON.stringify({ method: "password" }),
    POOLS: {
      getByName() {
        return {
          async fetch(request) {
            assert.equal(new URL(request.url).pathname, "/health");
            warmups++;
            await ready.promise;
            return new Response("ok");
          },
        };
      },
    },
  };
  const response = await worker.fetch(
    new Request(`${env.APP_ORIGIN}/api/auth/quorem-config`),
    configuration,
    {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(warmups, 1);
  assert.equal(pending.length, 1);
  ready.resolve();
  await Promise.all(pending);
});
