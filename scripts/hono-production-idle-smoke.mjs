/** Verify Neon suspension through its control plane while an authenticated lobby socket stays open. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { activeProduction } from "./hono-production-state.mjs";
import { createProductionBenchmarkActors } from "./hono-production-workload-actors.mjs";

const WebSocket = createRequire(new URL("../apps/api/package.json", import.meta.url))("ws");
const origin = "https://quorem.app";

async function endpoint(env) {
  const project = env.NEON_PROJECT_ID;
  if (!/^[a-z0-9-]{1,60}$/.test(project ?? "") || !env.NEON_API_KEY)
    throw new Error("Neon control-plane credentials unavailable");
  const api = async (path) => {
    const response = await fetch(`https://console.neon.tech/api/v2/projects/${project}${path}`, {
      headers: { authorization: `Bearer ${env.NEON_API_KEY}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Neon control-plane request failed: ${response.status}`);
    return response.json();
  };
  const branches = (await api("/branches")).branches.filter(
    (branch) => branch.default || branch.primary,
  );
  if (branches.length !== 1) throw new Error("Ambiguous production branch");
  const match = (await api(`/branches/${branches[0].id}/endpoints`)).endpoints.filter(
    (candidate) => candidate.type === "read_write",
  );
  if (match.length !== 1 || match[0].suspend_timeout_seconds !== 300)
    throw new Error("Unexpected production autosuspend settings");
  return async () => (await api(`/endpoints/${match[0].id}`)).endpoint.current_state;
}

async function disbandParty(party, cookie) {
  const auth = await fetch(`${origin}/api/auth/token`, {
    headers: { cookie: cookie, origin },
    signal: AbortSignal.timeout(10_000),
  });
  if (!auth.ok) throw new Error("Smoke cleanup authentication failed");
  const token = (await auth.json()).token;
  const response = await fetch(`${origin}/v1/parties/${party}/disband`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, origin, "idempotency-key": randomUUID() },
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Smoke lobby cleanup failed: ${response.status}`);
}

async function verify(env) {
  const getState = await endpoint(env);
  const { database } = activeProduction(env);
  database.search = "?sslmode=verify-full";
  const fixture = await createProductionBenchmarkActors({
    databaseURL: database.href,
    authSecret: env.BETTER_AUTH_SECRET,
    count: 1,
    sessionMinutes: 25,
  });
  let socket, party, bearer, keepalive;
  let failed = false;
  try {
    const cookie = fixture.actors[0].cookie;
    const request = async (path, options = {}) => {
      const response = await fetch(origin + path, {
        ...options,
        headers: {
          cookie,
          origin,
          ...(bearer && { authorization: `Bearer ${bearer}` }),
          ...options.headers,
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Smoke HTTP request failed: ${response.status}`);
      return response.json();
    };
    const legacy = await fetch(`${origin}/v1/presence/heartbeat`, {
      method: "POST",
      headers: { cookie, origin },
      signal: AbortSignal.timeout(10_000),
    });
    const marker = legacy.headers.get("set-cookie")?.split(";")[0];
    if (legacy.status !== 410 || marker !== "__Secure-quorem-retired-presence=1")
      throw new Error("Retired heartbeat marker unavailable");
    const flaggedCookie = `${cookie}; ${marker}`;
    const obsoleteToken = await fetch(`${origin}/api/auth/token`, {
      headers: { cookie: flaggedCookie, origin },
      signal: AbortSignal.timeout(10_000),
    });
    await obsoleteToken.body?.cancel();
    if (obsoleteToken.status !== 401) throw new Error("Retired tab still mints tokens");
    bearer = (
      await request("/api/auth/token", {
        headers: { cookie: flaggedCookie, "x-quorem-auth-client": "room-sockets" },
      })
    ).token;
    await request("/v1/parties/current");
    party = (
      await request("/v1/parties", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
        body: JSON.stringify({ difficulties: ["easy"], accessMode: "accounts_only" }),
      })
    ).party.id;
    socket = new WebSocket(
      `wss://quorem.app/v1/parties/${party}/events`,
      ["quorem", "quorem-hibernate"],
      {
        headers: { cookie, origin },
        handshakeTimeout: 10_000,
      },
    );
    let pongs = 0;
    let lastPong = 0;
    const ready = new Promise((resolve, reject) => {
      socket.once("error", () => reject(new Error("Lobby socket unavailable")));
      socket.once("close", () =>
        reject(new Error("Lobby socket closed before its first snapshot")),
      );
      socket.on("message", (buffer) => {
        const text = String(buffer);
        if (text === "quorem:pong") {
          pongs++;
          lastPong = Date.now();
          return;
        }
        try {
          const frame = JSON.parse(text);
          if (typeof frame.receipt === "string")
            socket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
          if (frame.payload?.type === "party.snapshot" && frame.payload.party?.id === party)
            resolve();
        } catch {
          reject(new Error("Invalid lobby socket frame"));
        }
      });
    });
    const timeout = new AbortController();
    try {
      await Promise.race([
        ready,
        delay(15_000, undefined, { signal: timeout.signal, ref: false }).then(() => {
          throw new Error("Lobby snapshot timed out");
        }),
      ]);
    } finally {
      timeout.abort();
    }
    if (socket.protocol !== "quorem-hibernate") throw new Error("Hibernating protocol unavailable");
    const ping = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send("quorem:ping");
    };
    ping();
    keepalive = setInterval(ping, 10_000);
    const started = Date.now();
    let previous;
    while (Date.now() - started <= 18 * 60_000) {
      const state = await getState();
      if (state !== previous) {
        console.log(
          JSON.stringify({ state, elapsedSeconds: Math.floor((Date.now() - started) / 1000) }),
        );
        previous = state;
      }
      if (socket.readyState !== WebSocket.OPEN || Date.now() - Math.max(started, lastPong) > 35_000)
        throw new Error("Lobby socket stopped answering without a reconnect");
      if ((state === "idle" || state === "suspended") && pongs > 0) {
        console.log(JSON.stringify({ suspendedWithLiveLobbySocket: true, pongs }));
        return;
      }
      await delay(20_000);
    }
    throw new Error("Neon did not suspend during the observation window");
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    clearInterval(keepalive);
    socket?.terminate();
    await (async () => {
      try {
        if (party) await disbandParty(party, fixture.actors[0].cookie);
      } finally {
        await fixture.dispose();
      }
    })().catch((error) => {
      if (!failed) throw error;
      console.error("Idle smoke cleanup failed after the observation error");
    });
  }
}

try {
  await verify(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Idle smoke failed");
  process.exitCode = 1;
}
