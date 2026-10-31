/** Same-origin elastic ingress; PostgreSQL owns product state and judge leases. */
import {
  POOL_REVISION_PATH,
  judgeSlot,
  limits,
  notification,
  preferredShard,
  withShardAffinity,
} from "./policy.js";
export { AppPool, Quorem, Judge, FastJudge } from "./router.js";
export { CaseSandbox } from "./case-sandbox.js";

function judgeName(slot, env) {
  return `judge-${slot}${env.JUDGE_FAST_REVISION ? `-${env.JUDGE_FAST_REVISION}` : ""}`;
}

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

async function caseRequest(request, env, attempt) {
  if (
    typeof env.JUDGE_CONTROL_TOKEN !== "string" ||
    env.JUDGE_CONTROL_TOKEN.length < 32 ||
    request.headers.get("Authorization") !== `Bearer ${env.JUDGE_CONTROL_TOKEN}` ||
    (!(request.method === "GET" && (attempt === "ready" || env.CASE_DIAGNOSTICS === "true")) &&
      !["POST", "DELETE"].includes(request.method))
  )
    return new Response(null, { status: 404 });
  if (!env.CASES) return new Response(null, { status: 503 });
  if (request.method === "GET" && attempt === "ready") return new Response(null, { status: 204 });
  const nonce = request.headers.get("x-quorem-owner-nonce"),
    scope = request.headers.get("x-quorem-owner-scope");
  const bound = !!nonce || !!scope;
  if (
    bound &&
    (!/^[a-f0-9-]{36}$/.test(nonce ?? "") ||
      !/^remote:[a-f0-9]{64}$/.test(scope ?? "") ||
      typeof env.CASE_OWNER_PRIVATE_KEY !== "string" ||
      typeof env.CASES.idFromName !== "function")
  )
    return new Response(null, { status: 503 });
  let caseFields = ["", "", "", "", "", ""];
  let attestedBody;
  if (bound && request.method === "POST") {
    try {
      const binding = request.headers.get("x-quorem-case-binding") ?? "",
        declared = request.headers.get("x-quorem-body-sha256") ?? "",
        ordinal = request.headers.get("x-quorem-case-ordinal") ?? "";
      if (
        !/^[a-f0-9]{64}$/.test(binding) ||
        !/^[a-f0-9]{64}$/.test(declared) ||
        !/^(-1|0|[1-9][0-9]{0,2})$/.test(ordinal) ||
        Number(ordinal) >= 320
      )
        throw new Error("Invalid case binding");
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Missing case body");
      const parts = [];
      let length = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Case input too large");
        }
        parts.push(next.value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        body.set(part, offset);
        offset += part.length;
      }
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== declared) throw new Error("Case body mismatch");
      attestedBody = body;
      caseFields = [
        binding,
        digest,
        ordinal,
        request.headers.get("x-case-language") ?? "",
        request.headers.get("x-case-memory") ?? "",
        request.headers.get("x-case-processes") ?? "",
      ];
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  const forwarded =
    attestedBody === undefined
      ? new Request(request, { headers })
      : new Request(request.url, {
          method: request.method,
          headers,
          body: attestedBody,
          signal: request.signal,
        });
  const response = await env.CASES.getByName(attempt, {
    locationHint: env.APP_LOCATION_HINT || "enam",
  }).fetch(forwarded);
  if (!bound) return response;
  if (
    !(
      (request.method === "POST" && response.status === 200) ||
      (request.method === "DELETE" && response.status === 204)
    )
  )
    return response;
  try {
    const namespace = env.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
    if (!/^[a-f0-9]{64}$/.test(namespace)) throw new Error("Invalid namespace");
    const keyBytes = Uint8Array.from(atob(env.CASE_OWNER_PRIVATE_KEY), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "Ed25519" }, false, [
      "sign",
    ]);
    const token = request.headers.get("x-case-token") ?? "";
    const message = new TextEncoder().encode(
      JSON.stringify([
        scope,
        namespace,
        request.method,
        attempt,
        token,
        response.status,
        nonce,
        ...caseFields,
      ]),
    );
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, message));
    const resultHeaders = new Headers(response.headers);
    resultHeaders.set("x-quorem-owner-namespace", namespace);
    resultHeaders.set("x-quorem-owner-signature", btoa(String.fromCharCode(...signature)));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resultHeaders,
    });
  } catch {
    await response.body?.cancel();
    return new Response(null, { status: 503 });
  }
}

const ingress = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN) return new Response("Unknown host", { status: 421 });
    if (url.pathname === "/internal/judge/wake") return wake(request, env);
    const attempt = url.pathname.match(/^\/internal\/case\/([a-zA-Z0-9-]{1,128})$/)?.[1];
    if (attempt) return caseRequest(request, env, attempt);
    if (url.pathname === "/internal" || url.pathname.startsWith("/internal/"))
      return new Response(null, { status: 404 });
    if (
      url.pathname !== "/health" &&
      !url.pathname.startsWith("/v1/") &&
      !url.pathname.startsWith("/api/auth/")
    )
      return new Response(null, { status: 404 });
    // Render login immediately; overlap cold startup with entering credentials.
    if (
      url.pathname === "/api/auth/quorem-config" &&
      request.method === "GET" &&
      env.AUTH_PUBLIC_CONFIG &&
      env.AUTH_PUBLIC_CONFIG !== "null"
    ) {
      ctx?.waitUntil(
        ingress
          .fetch(new Request(new URL("/health", url), request), env)
          .then((response) => response.body?.cancel())
          .catch(() => {}),
      );
      return Response.json(JSON.parse(env.AUTH_PUBLIC_CONFIG), {
        headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" },
      });
    }
    const capacity = limits(env);
    if (!env.APP_RUNTIME_REVISION)
      return new Response("Application configuration unavailable", { status: 503 });
    const start = preferredShard(request, capacity.shards);
    for (let attempt = 0; attempt < capacity.shards; attempt++) {
      const shard = (start + attempt) % capacity.shards;
      const pool = `${shard}-${env.APP_RUNTIME_REVISION}`;
      const forwarded = new Request(request.clone());
      for (const key of ["x-quorem-lease", "x-quorem-slot", "x-quorem-revision"])
        forwarded.headers.delete(key);
      forwarded.headers.set("x-quorem-pool", pool);
      const started = performance.now();
      const coordinator = env.POOLS.getByName(pool, {
        locationHint: env.APP_LOCATION_HINT || "enam",
      });
      // Omit lease headers so an old coordinator cannot start a container during the probe.
      const check = await coordinator.fetch(new Request("https://pool" + POOL_REVISION_PATH));
      const current =
        check.status === 204 && check.headers.get("x-quorem-revision") === env.APP_RUNTIME_REVISION;
      await check.body?.cancel();
      if (!current) continue;
      const response = await coordinator.fetch(forwarded);
      // Capacity rejects happen before dispatch; an admitted application command never replays.
      if (response.status !== 503 || response.headers.get("X-Quorem-Capacity") !== "full") {
        if (
          ctx &&
          request.method === "GET" &&
          response.ok &&
          /^\/v1\/(?:workspaces|interviews|matches)\/[0-9a-fA-F-]{36}$/.test(url.pathname)
        ) {
          ctx.waitUntil(
            env.JUDGES.getByName(judgeName(0, env), {
              locationHint: env.APP_LOCATION_HINT || "enam",
            })
              .fetch("https://judge/prewarm", { method: "POST" })
              .then((r) => r.body?.cancel())
              .catch(() => {}),
          );
        }
        const result = withShardAffinity(response, shard);
        result.headers.append(
          "Server-Timing",
          `app;dur=${(performance.now() - started).toFixed(1)}`,
        );
        return result;
      }
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
    let safeToAck = false;
    let needsContinuation = false;
    let reservationToken;
    let preferred;
    try {
      const maximum = limits(env).judges;
      preferred = env.JUDGES.getByName(judgeName(0, env), {
        locationHint: env.APP_LOCATION_HINT || "enam",
      });
      try {
        const reservation = await preferred.fetch("https://judge/reserve", { method: "POST" });
        if (reservation.ok) reservationToken = (await reservation.json()).reservation;
      } catch {
        // The warm hint is optional; delivery must still reach another judge.
      }
      const slot = reservationToken || maximum === 1 ? 0 : 1 + judgeSlot(valid[0].id, maximum - 1);
      const response = await env.JUDGES.getByName(judgeName(slot, env), {
        locationHint: env.APP_LOCATION_HINT || "enam",
      }).fetch("https://judge/wake", { method: "POST" });
      const body = await response.json();
      safeToAck = response.status === 200 && body.queued === 0 && body.running === 0;
      needsContinuation = response.status === 202;
    } catch {
      /* Durable messages retry when startup, drain or dependencies are unavailable. */
    } finally {
      if (reservationToken)
        await preferred
          .fetch("https://judge/release", { method: "POST", body: reservationToken })
          .catch(() => {});
    }
    if (needsContinuation) {
      try {
        // Publish before acknowledging; duplicate wakeups are fenced by the database.
        await env.JUDGE_WAKE.send(notification(valid[0].body), { delaySeconds: 2 });
        safeToAck = true;
      } catch {
        // Preserve the original wake if the continuation was not durably accepted.
      }
    }
    // A quiet-grace drain or a durable continuation covers every wake in this batch.
    for (const message of valid) {
      if (safeToAck) message.ack();
      else message.retry({ delaySeconds: Math.min(30, 2 ** Math.min(message.attempts ?? 1, 5)) });
    }
  },
};

export default ingress;
