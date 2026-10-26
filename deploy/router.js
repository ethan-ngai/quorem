import { DurableObject } from "cloudflare:workers";
import { ContainerLifecycle } from "./container.js";
import {
  APP_IDLE_MS,
  HTTP_LEASE_MS,
  SOCKET_LEASE_MS,
  RENEW_MS,
  chooseInstance,
  isSocketRequest,
  integer,
  limits,
} from "./policy.js";

function trackedBody(response, finish, ctx) {
  if (!response.body) {
    ctx.waitUntil(Promise.resolve().then(finish));
    return response;
  }
  const stream = new TransformStream();
  ctx.waitUntil(
    response.body
      .pipeTo(stream.writable)
      .catch(() => {})
      .finally(finish),
  );
  return new Response(stream.readable, response);
}

/** Each coordinator owns only its shard, and crash-stale reservations expire. */
export class AppPool extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.capacity = limits(env);
    this.leases = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list({ prefix: "lease:" });
      for (const [key, lease] of stored) {
        if (lease.expires > Date.now()) this.leases.set(key.slice(6), lease);
        else await ctx.storage.delete(key);
      }
      await this.scheduleCleanup();
    });
  }

  async release(id) {
    this.leases.delete(id);
    await this.ctx.storage.delete("lease:" + id);
    await this.scheduleCleanup();
  }

  async scheduleCleanup() {
    const next = Math.min(...[...this.leases.values()].map((lease) => lease.expires));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    for (const [id, lease] of this.leases) if (lease.expires <= Date.now()) await this.release(id);
    await this.scheduleCleanup();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__leases") {
      const { renew = [], release = [] } = await request.json();
      for (const id of release) await this.release(id);
      for (const item of renew) {
        const id = typeof item === "string" ? item : item.id;
        let lease = this.leases.get(id);
        if (
          !lease &&
          typeof item === "object" &&
          typeof id === "string" &&
          id.length <= 128 &&
          Number.isInteger(item.slot) &&
          item.slot >= 0 &&
          item.slot < this.capacity.instances &&
          ["http", "sockets"].includes(item.kind)
        ) {
          lease = { slot: item.slot, kind: item.kind };
          this.leases.set(id, lease);
        }
        if (lease) {
          lease.expires = Date.now() + (lease.kind === "sockets" ? SOCKET_LEASE_MS : HTTP_LEASE_MS);
          await this.ctx.storage.put("lease:" + id, lease);
        }
      }
      await this.scheduleCleanup();
      return new Response(null, { status: 204 });
    }
    for (const [id, lease] of this.leases) if (lease.expires <= Date.now()) await this.release(id);
    const kind = isSocketRequest(request) ? "sockets" : "http";
    const slot = chooseInstance(this.leases, kind, this.capacity, Date.now());
    if (slot < 0)
      return new Response("Application capacity reached", {
        status: 503,
        headers: { "X-Quorem-Capacity": "full", "Retry-After": "1" },
      });
    const id = crypto.randomUUID();
    const pool = request.headers.get("x-quorem-pool");
    this.leases.set(id, {
      slot,
      kind,
      expires: Date.now() + (kind === "sockets" ? SOCKET_LEASE_MS : HTTP_LEASE_MS),
    });
    await this.ctx.storage.put("lease:" + id, this.leases.get(id));
    await this.scheduleCleanup();
    const forwarded = new Request(request);
    forwarded.headers.set("x-quorem-lease", id);
    forwarded.headers.set("x-quorem-slot", String(slot));
    try {
      const name = `app-${pool}-${slot}`;
      let response = await this.env.APPS.getByName(name, {
        locationHint: this.env.APP_LOCATION_HINT || "enam",
      }).fetch(forwarded);
      if (response.status === 101 && response.webSocket) return response;
      if (response.headers.has("X-Quorem-Capacity")) {
        const headers = new Headers(response.headers);
        headers.delete("X-Quorem-Capacity");
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return trackedBody(response, () => this.release(id), this.ctx);
    } catch {
      await this.release(id);
      return new Response("Application temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "1" },
      });
    }
  }
}

/** Accepted proxy sockets pin their owning container; alarms renew coordinator leases. */
export class Quorem extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lifecycle = new ContainerLifecycle(ctx, JSON.parse(env.APP_RUNTIME_ENV), 8088);
    this.sockets = new Map();
    this.requests = new Map();
    this.http = 0;
    this.lastActivity = Date.now();
  }

  async lease(pool, body) {
    await this.env.POOLS.getByName(pool).fetch("https://pool/__leases", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async active() {
    this.lastActivity = Date.now();
    await this.ctx.storage.setAlarm(
      this.lastActivity + (this.sockets.size || this.http ? RENEW_MS : APP_IDLE_MS),
    );
  }

  async alarm() {
    if (this.sockets.size || this.http) {
      await this.ctx.container.setInactivityTimeout(APP_IDLE_MS);
      const byPool = new Map();
      for (const { pool, lease, slot, kind } of [
        ...this.sockets.values(),
        ...this.requests.values(),
      ]) {
        if (!byPool.has(pool)) byPool.set(pool, []);
        byPool.get(pool).push({ id: lease, slot, kind });
      }
      await Promise.all([...byPool].map(([pool, renew]) => this.lease(pool, { renew })));
      await this.active();
    } else if (Date.now() - this.lastActivity >= APP_IDLE_MS) {
      await this.lifecycle.stop();
    } else await this.ctx.storage.setAlarm(this.lastActivity + APP_IDLE_MS);
  }

  async fetch(request) {
    const pool = request.headers.get("x-quorem-pool");
    const lease = request.headers.get("x-quorem-lease");
    const slot = Number(request.headers.get("x-quorem-slot"));
    if (!pool || !lease) return new Response(null, { status: 403 });
    this.http++;
    this.requests.set(lease, {
      pool,
      lease,
      slot,
      kind: isSocketRequest(request) ? "sockets" : "http",
    });
    await this.active();
    let response;
    try {
      response = await this.lifecycle.forward(request);
    } catch {
      this.http--;
      this.requests.delete(lease);
      await this.active();
      return new Response("Application starting or unavailable", {
        status: 503,
        headers: { "Retry-After": "2" },
      });
    }
    if (response.status !== 101 || !response.webSocket) {
      return trackedBody(
        response,
        async () => {
          this.http--;
          this.requests.delete(lease);
          await this.active();
        },
        this.ctx,
      );
    }
    this.http--;
    this.requests.delete(lease);
    const upstream = response.webSocket;
    upstream.accept();
    const pair = new WebSocketPair();
    const client = pair[0],
      server = pair[1];
    server.accept();
    this.sockets.set(server, { pool, lease, slot, kind: "sockets" });
    let closed = false;
    const close = (code = 1000, reason = "") => {
      if (closed) return;
      closed = true;
      this.sockets.delete(server);
      const safeCode = code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
      try {
        server.close(safeCode, reason);
      } catch {
        /* Peer already closed. */
      }
      try {
        upstream.close(safeCode, reason);
      } catch {
        /* Peer already closed. */
      }
      this.ctx.waitUntil(Promise.all([this.lease(pool, { release: [lease] }), this.active()]));
    };
    upstream.addEventListener("message", (event) => {
      try {
        server.send(event.data);
      } catch {
        close(1011);
      }
    });
    server.addEventListener("message", (event) => {
      try {
        upstream.send(event.data);
      } catch {
        close(1011);
      }
    });
    for (const socket of [upstream, server]) {
      socket.addEventListener("close", (event) => close(event.code, event.reason));
      socket.addEventListener("error", () => close(1011));
    }
    await this.active();
    return new Response(null, { status: 101, webSocket: client, headers: response.headers });
  }
}

/** Every arrival waits for a drain at or after its own generation, including arrivals during a drain. */
export class Judge extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lifecycle = new ContainerLifecycle(ctx, JSON.parse(env.JUDGE_RUNTIME_ENV), 8090, 120_000);
    this.generation = 0;
    this.completed = 0;
    this.idleMs = integer(env.JUDGE_IDLE_MS, 120_000, 15_000, 600_000);
  }

  async runDrain() {
    const generation = this.generation;
    await this.lifecycle.ensureReady();
    await this.ctx.container.setInactivityTimeout(300_000);
    try {
      const response = await this.lifecycle.forward(
        new Request("https://judge/internal/drain", {
          method: "POST",
          headers: { Authorization: `Bearer ${this.env.JUDGE_CONTROL_TOKEN}` },
        }),
        240_000,
      );
      const status = response.status;
      let body;
      try {
        body = await response.json();
      } catch {
        return { status: 503 };
      }
      if (status === 200 && body.queued === 0 && body.running === 0) {
        this.completed = generation;
        return { status: 200, queued: 0, running: 0 };
      }
      return { status: status === 202 ? 202 : 503 };
    } finally {
      await this.ctx.container.setInactivityTimeout(this.idleMs);
      await this.ctx.storage.setAlarm(Date.now() + this.idleMs);
    }
  }

  async alarm() {
    if (this.draining) {
      await this.ctx.storage.setAlarm(Date.now() + this.idleMs);
      return;
    }
    await this.lifecycle.stop();
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const generation = ++this.generation;
    while (this.completed < generation) {
      this.draining ??= this.runDrain()
        .catch(() => ({ status: 503 }))
        .finally(() => {
          this.draining = undefined;
        });
      const result = await this.draining;
      if (result.status !== 200) return Response.json(result, { status: result.status });
    }
    return Response.json({ queued: 0, running: 0 });
  }
}
