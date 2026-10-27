/** Bounded demand routing; leases repair coordinator/client crashes without permanent reservations. */
export const HTTP_LEASE_MS = 120_000;
export const SOCKET_LEASE_MS = 45_000;
export const APP_IDLE_MS = 600_000;
export const ROUTE_COOKIE = "__Host-quorem-route";
export const RENEW_MS = 15_000;

export function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error("Invalid capacity configuration");
  return parsed;
}

export function limits(env) {
  return {
    shards: integer(env.APP_POOL_SHARDS, 4, 1, 16),
    instances: integer(env.APP_INSTANCES_PER_SHARD, 2, 1, 8),
    http: integer(env.APP_HTTP_CAPACITY, 32, 1, 256),
    sockets: integer(env.APP_WS_CAPACITY, 512, 1, 2048),
    judges: integer(env.JUDGE_MAX_INSTANCES, 8, 1, 8),
  };
}

export function isSocketRequest(request) {
  return Boolean(
    request.method === "GET" &&
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    request.headers
      .get("connection")
      ?.split(",")
      .some((token) => token.trim().toLowerCase() === "upgrade") &&
    (/^\/v1\/memberships\/events$/.test(new URL(request.url).pathname) ||
      /^\/v1\/(?:(?:interviews|matches)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|match-invites\/[A-Za-z0-9_-]{43})\/events$/.test(
        new URL(request.url).pathname,
      )),
  );
}

export function chooseInstance(leases, kind, capacity, now, warmSlots = new Map()) {
  const counts = Array.from({ length: capacity.instances }, () => ({ http: 0, sockets: 0 }));
  for (const lease of leases.values())
    if (lease.expires > now && counts[lease.slot]) counts[lease.slot][lease.kind]++;
  const available = counts
    .map((count, slot) => ({
      slot,
      active: count.http + count.sockets,
      http: count.http + (kind === "http" ? 1 : 0),
      sockets: count.sockets + (kind === "sockets" ? 1 : 0),
    }))
    .filter((count) => count.http <= capacity.http && count.sockets <= capacity.sockets);
  // Warmth is advisory; every candidate still satisfies independent capacity ceilings.
  return (
    available.find((count) => warmSlots.get(count.slot) > now)?.slot ??
    available.find((count) => count.active > 0)?.slot ??
    available[0]?.slot ??
    -1
  );
}

export function judgeSlot(id, maximum) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % maximum;
}

export function notification(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["jobId"].includes(key))
  )
    return undefined;
  if (typeof value.jobId !== "string" || !/^[a-zA-Z0-9-]{8,128}$/.test(value.jobId))
    return undefined;
  return { jobId: value.jobId };
}

/** Affinity is a routing hint only; all authorization and capacity checks remain authoritative. */
export function preferredShard(request, shards) {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${ROUTE_COOKIE}=([0-9]{1,2})(?:;|$)`));
  if (match && Number(match[1]) < shards) return Number(match[1]);
  // Pack low traffic into warm capacity; overflow still visits every bounded shard.
  return 0;
}

export function withShardAffinity(response, shard) {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${ROUTE_COOKIE}=${shard}; Path=/; Max-Age=${APP_IDLE_MS / 1000}; HttpOnly; Secure; SameSite=Lax`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: response.webSocket,
  });
}
