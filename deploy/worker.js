/** Same-origin elastic ingress; PostgreSQL owns product state and judge leases. */
import { judgeSlot, limits, notification, preferredShard, withShardAffinity } from "./policy.js";
export { AppPool, Quorem, Judge } from "./router.js";

async function wake(request, env) {
  if (typeof env.JUDGE_CONTROL_TOKEN !== "string" || env.JUDGE_CONTROL_TOKEN.length < 32)
    return new Response(null, { status: 503 });
  if (
    request.method !== "POST" ||
    request.headers.get("Authorization") !== `Bearer ${env.JUDGE_CONTROL_TOKEN}`
  )
    return new Response(null, { status: 404 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let bytes = new Uint8Array(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (bytes.length + value.length > 1024) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes);
      next.set(value, bytes.length);
      bytes = next;
    }
    const message = notification(JSON.parse(new TextDecoder().decode(bytes)));
    if (!message) return new Response(null, { status: 400 });
    // A successful response is durable before admission can commit, including a fully idle fleet.
    await env.JUDGE_WAKE.send(message);
    return new Response(null, { status: 202 });
  } catch {
    return new Response("Execution wake unavailable", { status: 503 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN) return new Response("Unknown host", { status: 421 });
    if (url.pathname === "/internal/judge/wake") return wake(request, env);
    if (url.pathname === "/internal" || url.pathname.startsWith("/internal/"))
      return new Response(null, { status: 404 });
    if (
      url.pathname !== "/health" &&
      !url.pathname.startsWith("/v1/") &&
      !url.pathname.startsWith("/api/auth/")
    )
      return new Response(null, { status: 404 });
    const capacity = limits(env);
    const start = preferredShard(request, capacity.shards);
    for (let attempt = 0; attempt < capacity.shards; attempt++) {
      const pool = String((start + attempt) % capacity.shards);
      const forwarded = new Request(request.clone());
      for (const key of ["x-quorem-lease", "x-quorem-slot"]) forwarded.headers.delete(key);
      forwarded.headers.set("x-quorem-pool", pool);
      const response = await env.POOLS.getByName(pool, {
        locationHint: env.APP_LOCATION_HINT || "enam",
      }).fetch(forwarded);
      // Capacity rejects happen before dispatch; an admitted application command never replays.
      if (response.status !== 503 || response.headers.get("X-Quorem-Capacity") !== "full")
        return withShardAffinity(response, Number(pool));
      await response.body?.cancel();
    }
    return new Response("Application capacity reached", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  },

  async queue(batch, env) {
    const valid = [];
    for (const message of batch.messages) {
      if (notification(message.body)) valid.push(message);
      else message.retry({ delaySeconds: 30 });
    }
    if (!valid.length) return;
    let empty = false;
    try {
      const maximum = limits(env).judges;
      const response = await env.JUDGES.getByName(`judge-${judgeSlot(valid[0].id, maximum)}`, {
        locationHint: env.APP_LOCATION_HINT || "enam",
      }).fetch("https://judge/wake", { method: "POST" });
      const body = await response.json();
      empty = response.status === 200 && body.queued === 0 && body.running === 0;
    } catch {
      /* Durable messages retry when startup, drain or dependencies are unavailable. */
    }
    // One quiet-grace drain covers every pre-admission wake already present in this batch.
    for (const message of valid) {
      if (empty) message.ack();
      else message.retry({ delaySeconds: Math.min(30, 2 ** Math.min(message.attempts ?? 1, 5)) });
    }
  },
};
