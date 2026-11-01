/** Controlled stage workload; browser-equivalent sockets and public product commands only. */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stagedOrigin, json } from "./hono-stage-deploy-acceptance.mjs";
import { createStagedActor } from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;

export async function runStageWorkload(env, deps = {}) {
  const api = stagedOrigin(env.HONO_STAGE_API_ORIGIN),
    browser = stagedOrigin(env.HONO_STAGE_BROWSER_ORIGIN);
  if (!env.ALLOWED_ORIGINS?.split(",").includes(browser))
    throw new Error("Invalid stage browser origin");
  const size = deps.matchCount ?? Number(env.HONO_STAGE_WORKLOAD_MATCHES ?? "2");
  if (!Number.isInteger(size) || size < 1 || size > 20) throw new Error("Invalid workload profile");
  const send = deps.fetch ?? fetch,
    makeActor = deps.createActor ?? createStagedActor;
  const Socket =
    deps.WebSocket ?? createRequire(new URL("../apps/api/package.json", import.meta.url))("ws");
  const wait = deps.delay ?? delay,
    now = deps.now ?? (() => performance.now());
  const deadline = now() + 600000;
  const stats = { http: [], command: [], jobs: [], errors: 0, disconnects: 0, reconnects: 0 };
  const actors = [],
    sockets = [],
    rooms = [],
    pending = [],
    polls = [];
  const controller = new AbortController();
  const activeSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]);
  let receipt,
    failure,
    cleanupFailure = false;
  const remaining = () => {
    const ms = deadline - now();
    if (ms <= 0) throw new Error("Workload deadline exceeded");
    return Math.max(1, Math.floor(Math.min(ms, 30000)));
  };
  async function request(
    actor,
    path,
    { method = "GET", body, expected = 200, command = false, cleanup = false } = {},
  ) {
    const start = now();
    try {
      const response = await send(`${api}${path}`, {
        method,
        headers: {
          origin: browser,
          ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : { cookie: actor.cookie }),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(command ? { "idempotency-key": randomUUID() } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: cleanup
          ? AbortSignal.timeout(5000)
          : AbortSignal.any([activeSignal, AbortSignal.timeout(remaining())]),
      });
      if (response.status !== expected) {
        await response.body?.cancel();
        throw new Error("Workload HTTP request failed");
      }
      return await json(response);
    } catch (error) {
      stats.errors++;
      throw error;
    } finally {
      const ms = now() - start;
      stats.http.push(ms);
      if (command) stats.command.push(ms);
    }
  }
  async function connect(actor, path, refresh, notice = () => {}) {
    const url = new URL(`${api}${path}/events`);
    url.protocol = "wss:";
    let current,
      closed = false,
      reconnecting = false,
      reconnectTask,
      retries = 0;
    const entry = {
      get open() {
        return current?.readyState === 1;
      },
      async close() {
        closed = true;
        if (!current || current.readyState === 3) {
          await reconnectTask;
          return;
        }
        const socket = current;
        await new Promise((resolve, reject) => {
          let finalTimer;
          const timer = setTimeout(() => {
            socket.terminate();
            finalTimer = setTimeout(() => reject(new Error("Socket closure unconfirmed")), 1000);
          }, 3000);
          socket.once("close", () => {
            clearTimeout(timer);
            clearTimeout(finalTimer);
            resolve();
          });
          if (socket.readyState === 0) socket.terminate();
          else socket.close();
        });
        await reconnectTask;
      },
    };
    sockets.push(entry);
    async function open() {
      remaining();
      const socket = new Socket(url.href, ["quorem", `bearer.${actor.token}`], {
        origin: browser,
        handshakeTimeout: remaining(),
        maxPayload: 262144,
      });
      current = socket;
      socket.on("error", () => {});
      socket.on("message", (data, binary) => {
        try {
          if (binary || data.length > 262144) throw new Error();
          const frame = JSON.parse(data.toString());
          if (!uuid.test(frame.receipt ?? "") || !("payload" in frame)) throw new Error();
          socket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
          notice(frame.payload);
        } catch {
          stats.errors++;
          socket.close(1002);
        }
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.terminate();
          finish(new Error("Socket handshake timeout"));
        }, remaining());
        const opened = () => finish();
        const failed = () => finish(new Error("Socket handshake failed"));
        function finish(error) {
          clearTimeout(timeout);
          socket.off("open", opened);
          socket.off("error", failed);
          socket.off("close", failed);
          if (error) reject(error);
          else resolve();
        }
        socket.once("open", opened);
        socket.once("error", failed);
        socket.once("close", failed);
      }).catch((error) => {
        stats.errors++;
        throw error;
      });
      socket.on("close", () => {
        if (!closed) {
          stats.disconnects++;
          if (!reconnecting) reconnectTask = reconnect();
        }
      });
    }
    async function reconnect() {
      reconnecting = true;
      try {
        while (!closed && retries < 3) {
          retries++;
          stats.reconnects++;
          try {
            await wait(250 * retries);
            if (closed) return;
            await open();
            await refresh();
            return;
          } catch {
            if (now() >= deadline) break;
          }
        }
      } finally {
        reconnecting = false;
      }
    }
    await open();
    await refresh();
    return entry;
  }
  try {
    for (let i = 0; i < size * 2; i++) {
      remaining();
      const fixture = await makeActor({
        databaseURL: env.QUOREM_STAGE_DATABASE_URL,
        authOrigin: api,
        authSecret: env.BETTER_AUTH_SECRET,
        mode: "stage",
        signal: activeSignal,
      });
      const actor = { fixture, cookie: fixture.sessionCookie };
      actors.push(actor);
      const auth = await request(actor, "/api/auth/token");
      if (
        typeof auth.token !== "string" ||
        !auth.token ||
        auth.token.length > 16384 ||
        /\s/.test(auth.token)
      )
        throw new Error("Invalid fixture token");
      if (actors.some((other) => other !== actor && other.token === auth.token))
        throw new Error("Duplicate actor identity");
      actor.token = auth.token;
    }
    for (let i = 0; i < size; i++) {
      const host = actors[2 * i],
        guest = actors[2 * i + 1];
      const room = await request(host, "/v1/matches", {
        method: "POST",
        command: true,
        expected: 201,
        body: {
          selectedProblemVersionId: host.fixture.problemVersionId,
          accessMode: "accounts_only",
          mode: "showdown",
        },
      });
      if (!uuid.test(room.id ?? "") || typeof room.inviteUrl !== "string")
        throw new Error("Invalid match response");
      if (rooms.some((existing) => existing.id === room.id)) throw new Error("Duplicate match");
      rooms.push({ id: room.id, host });
      const invite = room.inviteUrl.split("/").at(-1);
      if (!invite || /[?#]/.test(invite)) throw new Error("Invalid invitation");
      await request(guest, "/v1/matches/join", {
        method: "POST",
        command: true,
        body: { inviteToken: invite },
      });
      await request(host, `/v1/matches/${room.id}/ready`, {
        method: "POST",
        command: true,
        body: { ready: true },
      });
      const ready = await request(guest, `/v1/matches/${room.id}/ready`, {
        method: "POST",
        command: true,
        body: { ready: true },
      });
      if (ready.state === "waiting")
        await request(host, `/v1/matches/${room.id}/start`, {
          method: "POST",
          command: true,
          body: {},
        });
      else if (ready.state !== "active") throw new Error("Match did not start");
      for (const actor of [host, guest]) {
        const snapshot = await request(actor, `/v1/matches/${room.id}`);
        const workspaces = snapshot.participants?.map((p) => p.workspaceId).filter(Boolean);
        if (workspaces?.length !== 1 || !uuid.test(workspaces[0]))
          throw new Error("Invalid participant workspace");
        if (actors.some((other) => other !== actor && other.workspace === workspaces[0]))
          throw new Error("Duplicate participant workspace");
        actor.workspace = workspaces[0];
        actor.room = room.id;
      }
    }
    for (let i = 0; i < actors.length; i += 4)
      await Promise.all(
        actors
          .slice(i, i + 4)
          .map((actor) =>
            connect(actor, `/v1/matches/${actor.room}`, () =>
              request(actor, `/v1/matches/${actor.room}`),
            ),
          ),
      );
    if (sockets.length !== size * 2 || sockets.some((s) => !s.open))
      throw new Error("Workload sockets unavailable");
    async function watchJob(job) {
      let fetching = false,
        dirty = false,
        finished = false,
        socket;
      let complete, rejectCompletion;
      const completion = new Promise((resolve, reject) => {
        complete = resolve;
        rejectCompletion = reject;
      });
      const refresh = async () => {
        if (fetching) {
          dirty = true;
          return;
        }
        fetching = true;
        try {
          do {
            dirty = false;
            const result = await request(job.actor, `/v1/submissions/${job.id}`);
            if (result.verdict === "accepted") {
              finished = true;
              stats.jobs.push(now() - job.started);
              complete();
              return;
            }
            if (result.verdict || ["failed", "cancelled"].includes(result.state))
              throw new Error("Workload execution failed");
          } while (dirty && !finished);
        } catch (error) {
          rejectCompletion(error);
          throw error;
        } finally {
          fetching = false;
        }
      };
      void completion.catch(() => {});
      const abort = () => rejectCompletion(new Error("Workload deadline exceeded"));
      activeSignal.addEventListener("abort", abort, { once: true });
      try {
        socket = await connect(job.actor, `/v1/submissions/${job.id}`, refresh, (payload) => {
          if (payload?.type === "changed" && !finished) void refresh().catch(() => {});
        });
        await completion;
      } finally {
        activeSignal.removeEventListener("abort", abort);
        await socket?.close();
      }
    }

    const jobIds = new Set();
    let nextAdmission = now();
    const admissionStarts = [];
    for (const actor of actors) {
      const until = nextAdmission - now();
      if (until > 0) await wait(until);
      if (sockets.slice(0, size * 2).some((s) => !s.open))
        throw new Error("Workload socket disconnected");
      const started = now();
      nextAdmission = started + 500;
      admissionStarts.push(started);
      pending.push(
        request(actor, "/v1/submissions", {
          method: "POST",
          command: true,
          expected: 202,
          body: { workspaceId: actor.workspace, kind: "run", source: actor.fixture.acceptedSource },
        }).then((admitted) => {
          if (!uuid.test(admitted.id ?? "")) throw new Error("Invalid admission response");
          if (jobIds.has(admitted.id)) throw new Error("Duplicate admission");
          jobIds.add(admitted.id);
          const job = { actor, id: admitted.id, started };
          const watch = watchJob(job);
          polls.push(watch);
          void watch.catch(() => {});
          return job;
        }),
      );
      // Attach a handler immediately; failures are still propagated below.
      pending.at(-1).catch(() => {});
    }
    const jobs = await Promise.all(pending);
    await Promise.all(polls);
    const summarize = (values) => ({
      count: values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
    });
    if (stats.errors) throw new Error("Workload transport errors");
    const spanMs = admissionStarts.at(-1) - admissionStarts[0];
    const rate = admissionStarts.length > 1 ? ((admissionStarts.length - 1) * 1000) / spanMs : 0;
    const maxGapMs = Math.max(
      0,
      ...admissionStarts.slice(1).map((start, i) => start - admissionStarts[i]),
    );
    if (size === 20 && rate < 1.9) throw new Error("Admission pacing target missed");
    receipt = {
      profile: size === 20 ? "baseline" : "smoke",
      matches: size,
      sessions: actors.length,
      admissions: jobs.length,
      admissionPacing: { targetPerSecond: 2, observedPerSecond: rate, spanMs, maxGapMs },
      httpIncludesSetup: true,
      http: summarize(stats.http),
      commands: summarize(stats.command),
      jobs: summarize(stats.jobs),
      errors: stats.errors,
      disconnects: stats.disconnects,
      reconnects: stats.reconnects,
      telemetry: "provider-unverified",
    };
  } catch (error) {
    failure = error;
  } finally {
    controller.abort();
    await Promise.allSettled(pending);
    await Promise.allSettled(polls);
    if (
      (await Promise.allSettled(sockets.map((socket) => socket.close()))).some(
        (result) => result.status === "rejected",
      )
    )
      cleanupFailure = true;
    for (const room of rooms) {
      try {
        await request(room.host, `/v1/matches/${room.id}/leave`, {
          method: "POST",
          command: true,
          body: {},
          cleanup: true,
        });
      } catch {
        cleanupFailure = true;
      }
    }
    for (const actor of actors) {
      try {
        await actor.fixture.dispose();
      } catch {
        cleanupFailure = true;
      }
    }
  }
  if (cleanupFailure) throw new Error("Workload cleanup unconfirmed");
  if (failure) throw failure;
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await runStageWorkload(process.env))}\n`);
  } catch {
    process.stderr.write("Stage workload failed; sensitive details withheld.\n");
    process.exitCode = 1;
  }
}
