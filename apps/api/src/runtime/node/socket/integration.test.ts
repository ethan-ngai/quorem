/** @file integration.test.ts @description Real PostgreSQL two-instance WebSocket conformance. @module events */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import WebSocket from "ws";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { developmentIdentity } from "../../../adapters/postgres/identity/repository.ts";
import { frameText } from "../../../adapters/events/fanout/common.ts";
import { PostgresFanout } from "../../../adapters/events/fanout/postgres.ts";
import { matchLifecycle } from "../../../adapters/postgres/matches/lifecycle/repository.ts";
import { matchInvitations } from "../../../adapters/postgres/matches/invitations/repository.ts";
import { normalizeSettings } from "../../../modules/matches/lifecycle/model.ts";
import { matchSocketSnapshot } from "../../../modules/events/socket/match.ts";
import { prearmReceipts } from "../../../adapters/postgres/events/scheduling/prearm.ts";
import { postgresDeadlines } from "../../../adapters/postgres/events/scheduling/deadlines.ts";
import { reconcileScheduledMatch } from "../../../adapters/postgres/matches/reconcile/repository.ts";
import { drainDeadlines } from "../../../modules/events/scheduling/scheduling.ts";
import { nodeCoordinator } from "../../../adapters/scheduling/shells.ts";
import { installNodeSockets } from "./server.ts";
import { submissionSnapshots } from "../../../adapters/postgres/judging/results/repository.ts";
import { submissionRoutes } from "../../../modules/judging/results/routes.ts";
import { createApp } from "../../../app.ts";
import { grantSecurity } from "./grant.ts";
import { guestRepository } from "../../../adapters/postgres/identity/guest.ts";
import {
  authenticateGuestRequest,
  newGuestToken,
} from "../../../modules/identity/guest/credentials.ts";
import { IdentityError } from "../../../modules/identity/model.ts";
import { interviewPresence } from "../../../adapters/postgres/interviews/presence/repository.ts";
import { interviewDocumentCommands } from "../../../adapters/postgres/interviews/document/commands.ts";
import { interviewMonitoring } from "../../../adapters/postgres/interviews/monitoring/repository.ts";
import { interviewCommands } from "../../../modules/events/socket/interview.ts";
import { readInterviewAccess } from "../../../adapters/postgres/interviews/lifecycle/access.ts";
import { capabilitiesInTransaction } from "../../../adapters/postgres/access/repository.ts";
const db = process.env.QUOREM_NODE_SOCKET_TEST_DATABASE_URL;
if (
  !db ||
  new URL(db).port !== "55472" ||
  new URL(db).pathname !== "/quorem_hono_node_socket_test" ||
  !["localhost", "127.0.0.1"].includes(new URL(db).hostname)
)
  throw new Error("Disposable socket database required");
const pool = createNodePool({
  connectionString: db,
  max: 8,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  onIdleError: () => {},
});
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
const receipts = prearmReceipts(run),
  deadlines = postgresDeadlines(run);
let active = 0;
const schedulerErrors: unknown[] = [];
const coordinator = nodeCoordinator(
  async (shard) => {
    active++;
    try {
      for (const id of await receipts.list(shard)) {
        const status = await receipts.settle(id);
        if (status === "committed") await receipts.acknowledge(id);
      }
      return await drainDeadlines(
        deadlines,
        (c) =>
          run((scope) =>
            scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
              reconcileScheduledMatch(tx, c.id, c.generation),
            ),
          ),
        shard,
        1,
      );
    } finally {
      active--;
    }
  },
  (error) => schedulerErrors.push(error),
);
const secret = new Uint8Array(32).fill(7);
const lifecycle = matchLifecycle(run, {
  inviteKey: secret,
  receipts,
  coordinator,
  shards: 1,
  guestCreation: true,
});
const invitations = matchInvitations(run, secret);
const listenerB = new URL(db);
listenerB.searchParams.set("application_name", "socket-31-listener-b");
const a = new PostgresFanout(db, db),
  b = new PostgresFanout(db, listenerB.toString());
const servers: Server[] = [];
const stops: (() => Promise<void>)[] = [];
const sockets: WebSocket[] = [];
const users = new Map([
  ["host-token", "socket-host"],
  ["member-token", "socket-member"],
]);
const expirations = new Map<string, number>();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const messages = new WeakMap<WebSocket, string[]>();
async function next(ws: WebSocket): Promise<Record<string, unknown>> {
  const queue = messages.get(ws)!;
  for (let i = 0; i < 500; i++) {
    const item = queue.shift();
    if (item) return JSON.parse(item);
    await delay(10);
  }
  throw new Error("message timeout");
}
async function connect(
  url: string,
  token?: string,
  autoAck = true,
  cookie?: string,
): Promise<WebSocket> {
  const ws = new WebSocket(url, token ? ["quorem", `bearer.${token}`] : ["quorem"], {
    headers: { Origin: "https://example.test", ...(cookie ? { Cookie: cookie } : {}) },
  });
  sockets.push(ws);
  const queue: string[] = [];
  messages.set(ws, queue);
  ws.on("message", (data) => {
    const envelope = JSON.parse(frameText(data)) as { receipt: string; payload: unknown };
    if (autoAck) ws.send(JSON.stringify({ type: "receipt", id: envelope.receipt }));
    queue.push(JSON.stringify(envelope.payload));
  });
  await once(ws, "open");
  return ws;
}
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES('socket-host','Host','account'),('socket-member','Member','account')",
  );
  await Promise.all([a.start(), b.start()]);
});
after(async () => {
  for (const ws of sockets) ws.terminate();
  await Promise.all(stops.map((stop) => stop()));
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all([a.close(), b.close()]);
  coordinator.close();
  while (active) await delay(10);
  await pool.end();
  assert.deepEqual(schedulerErrors, []);
});
async function start(bus: PostgresFanout, id: string): Promise<string> {
  const server = createServer((_req, res) => res.writeHead(404).end());
  servers.push(server);
  stops.push(
    installNodeSockets(server, {
      origins: ["https://example.test"],
      heartbeatMs: 1000,
      resolve: async (request) => {
        const url = new URL(request.url);
        if (url.pathname !== "/match") return undefined;
        const token = (request.headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((x) => x.trim())
          .find((x) => x.startsWith("bearer."))
          ?.slice(7);
        return {
          mode: "match",
          security: {
            verify: async () => {
              const user = users.get(token ?? "");
              if (!user)
                throw new (await import("../../../modules/identity/model.ts")).IdentityError(
                  "unauthorized",
                );
              return {
                principal: await run((scope) => developmentIdentity(scope, user)),
                binding: `grant:${user}`,
                ...(expirations.has(token ?? "")
                  ? { expiresAt: expirations.get(token ?? "") }
                  : {}),
              };
            },
            authorize: async (principal) => {
              if (!principal) throw new Error("no principal");
              const match = (await lifecycle.read(principal, id)) as { version: string };
              return match.version;
            },
          },
          subscription: {
            subscribe: (notify, lost, signal) =>
              bus.subscribe(`/matches/${id}`, notify, lost, signal),
          },
          snapshot: matchSocketSnapshot(id, lifecycle),
        };
      },
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `ws://127.0.0.1:${address.port}`;
}
void test("real sockets reauthorize cross-instance notices, member removal", async () => {
  const host = await run((scope) => developmentIdentity(scope, "socket-host")),
    member = await run((scope) => developmentIdentity(scope, "socket-member"));
  const room = (await lifecycle.create(
    host,
    "create",
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string; inviteUrl: string };
  const token = room.inviteUrl.slice("/invite/".length);
  await invitations.join(member, "join", token);
  const [baseA, baseB] = await Promise.all([start(a, room.id), start(b, room.id)]);
  const [hostWs, memberWs] = await Promise.all([
    connect(`${baseA}/match`, "host-token"),
    connect(`${baseB}/match`, "member-token"),
  ]);
  assert.equal((await next(hostWs)).type, "match.updated");
  assert.equal((await next(memberWs)).type, "match.updated");
  const event = (type: string) => ({
    id: crypto.randomUUID(),
    aggregateId: room.id,
    version: "0",
    type,
    occurredAt: new Date().toISOString(),
  });
  await lifecycle.mutate(member, room.id, "leave", "leave", null);
  const closed = once(memberWs, "close");
  await a.publish(`/matches/${room.id}`, event("match.updated"));
  assert.equal((await closed)[0], 1008);
  const hostUpdated = await next(hostWs);
  assert.equal(hostUpdated.type, "match.updated");
  const hostClosed = once(hostWs, "close");
  await pool.query("UPDATE users SET disabled=true WHERE id='socket-host'");
  await a.publish(`/matches/${room.id}`, event("match.updated"));
  assert.equal((await hostClosed)[0], 1008);
  await pool.query("UPDATE users SET disabled=false WHERE id='socket-host'");
  await lifecycle.mutate(host, room.id, "cleanup", "leave", null);
});
void test("credential expiry, grant rotation and terminal snapshot close sockets", async () => {
  const host = await run((scope) => developmentIdentity(scope, "socket-host"));
  const room = (await lifecycle.create(
    host,
    "expiry-create",
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string; inviteUrl: string };
  const base = await start(a, room.id);
  expirations.set("host-token", Date.now() + 1300);
  const expiring = await connect(`${base}/match`, "host-token");
  await next(expiring);
  const expiryClose = once(expiring, "close");
  assert.equal((await expiryClose)[0], 1008);
  expirations.delete("host-token");
  const rotated = await connect(`${base}/match`, "host-token");
  await next(rotated);
  const rotationClose = once(rotated, "close");
  users.set("host-token", "socket-member");
  assert.equal((await rotationClose)[0], 1008);
  users.set("host-token", "socket-host");
  const terminal = await connect(`${base}/match`, "host-token");
  await next(terminal);
  const terminalClose = once(terminal, "close");
  await pool.query(
    "UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [room.id],
  );
  await b.publish(`/matches/${room.id}`, {
    id: crypto.randomUUID(),
    aggregateId: room.id,
    version: "0",
    type: "match.updated",
    occurredAt: new Date().toISOString(),
  });
  let event;
  do {
    event = await next(terminal);
  } while (event.type === "heartbeat");
  assert.equal(event.type, "match.completed");
  assert.equal((await terminalClose)[0], 1000);
});

void test("interview leases renew while a real document push is blocked, and release on disconnect", async () => {
  const actor = await run((scope) => developmentIdentity(scope, "socket-host"));
  const id = crypto.randomUUID(),
    epoch = crypto.randomUUID();
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','socket','test','test')",
    [crypto.randomUUID(), actor.userId],
  );
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'socket','{}','python','',$3,$4,$5,'x',$6,'y')",
    [id, actor.userId, epoch, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer')",
    [id, actor.userId],
  );
  const presence = interviewPresence(run),
    server = createServer((_req, res) => res.writeHead(404).end());
  servers.push(server);
  stops.push(
    installNodeSockets(server, {
      origins: ["https://example.test"],
      heartbeatMs: 1000,
      resolve: async () => {
        const lease = await presence.acquire(actor, id);
        return {
          mode: "interview",
          security: {
            verify: async () => ({ principal: actor, binding: "interview-grant" }),
            authorize: async (principal) => {
              assert.ok(principal);
              const access = await run((scope) =>
                scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
                  readInterviewAccess(tx, principal, id, capabilitiesInTransaction, {
                    active: true,
                  }),
                ),
              );
              return `${access.role}:${access.questionEpoch}`;
            },
          },
          subscription: {
            subscribe: (notify, lost, signal) =>
              a.subscribe(`/interviews/${id}`, notify, lost, signal),
          },
          commands: interviewCommands(id, {
            documents: interviewDocumentCommands(run),
            presence,
            monitoring: interviewMonitoring(run),
          }),
          renew: (p) => presence.renew(p, id, lease),
          release: () => presence.release(actor, id, lease),
        };
      },
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const ws = await connect(`ws://127.0.0.1:${address.port}/interview`, "host-token");
  assert.equal((await next(ws)).type, "changed");
  await delay(350);
  const locked = await pool.connect();
  await locked.query("BEGIN");
  await locked.query("SELECT id FROM interviews WHERE id=$1 FOR UPDATE", [id]);
  try {
    ws.send(
      `{"id":"push-id","type":"push","key":"push-key-123","push":{"epoch":"${epoch}","version":0,"updates":[{"clientID":"client","changes":[[0,"\\u0061"]]}]}}`,
    );
    await delay(100);
    ws.send('{"id":"peers-id","type":"peers"}');
    let advisory;
    do {
      advisory = await next(ws);
    } while (advisory.type === "heartbeat");
    assert.equal(advisory.id, "peers-id");
    await delay(750);
    const lease = (
      await pool.query(
        "SELECT EXTRACT(EPOCH FROM expires_at-clock_timestamp()) AS remaining FROM realtime_presence_leases WHERE topic=$1",
        [`/interviews/${id}`],
      )
    ).rows[0];
    assert.ok(Number(lease.remaining) > 25);
  } finally {
    await locked.query("ROLLBACK");
    locked.release();
  }
  let response;
  do {
    response = await next(ws);
  } while (response.id !== "push-id");
  assert.equal(response.id, "push-id");
  assert.equal(response.error, undefined);
  assert.equal(
    (await pool.query("SELECT source FROM interviews WHERE id=$1", [id])).rows[0].source,
    "a",
  );
  const closed = once(ws, "close");
  ws.close();
  await closed;
  for (let i = 0; i < 100; i++) {
    if (
      (
        await pool.query("SELECT count(*)::int AS n FROM realtime_presence_leases WHERE topic=$1", [
          `/interviews/${id}`,
        ])
      ).rows[0].n === 0
    )
      break;
    await delay(10);
  }
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM realtime_presence_leases WHERE topic=$1", [
        `/interviews/${id}`,
      ])
    ).rows[0].n,
    0,
  );
});

void test("lost LISTEN closes sockets and reconnect repairs from the authoritative snapshot", async () => {
  const host = await run((scope) => developmentIdentity(scope, "socket-host"));
  const room = (await lifecycle.create(
    host,
    "repair-create",
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string; inviteUrl: string };
  const base = await start(b, room.id);
  const socket = await connect(`${base}/match`, "host-token");
  await next(socket);
  const lost = once(socket, "close");
  const killed = await pool.query(
    "SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE application_name='socket-31-listener-b' AND pid<>pg_backend_pid()",
  );
  assert.equal(killed.rows.length, 1);
  assert.equal(killed.rows[0].ok, true);
  assert.equal((await lost)[0], 1013);
  await lifecycle.mutate(host, room.id, "repair-ready", "ready", true);
  let recovered = false;
  for (let i = 0; i < 100; i++) {
    try {
      const stop = await b.subscribe(
        `/matches/${room.id}`,
        () => {},
        () => {},
      );
      stop();
      recovered = true;
      break;
    } catch {
      await delay(25);
    }
  }
  assert.equal(recovered, true);
  const replacement = await connect(`${base}/match`, "host-token");
  const current = await next(replacement);
  assert.equal(current.type, "match.updated");
  assert.equal(
    (current.payload as { participants: { ready: boolean }[] }).participants[0].ready,
    true,
  );
  await lifecycle.mutate(host, room.id, "repair-close", "leave", null);
  replacement.close();
});

void test("a stalled browser that withholds receipts is disconnected", async () => {
  const host = await run((scope) => developmentIdentity(scope, "socket-host"));
  const room = (await lifecycle.create(
    host,
    "stalled-create",
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string; inviteUrl: string };
  const base = await start(a, room.id);
  const stalled = await connect(`${base}/match`, "host-token", false);
  assert.equal((await next(stalled)).type, "match.updated");
  const closed = once(stalled, "close");
  assert.equal((await closed)[0], 1013);
  await lifecycle.mutate(host, room.id, "stalled-close", "leave", null);
});

void test("verified guest grants recheck real revocation without retaining tokens", async () => {
  const host = await run((scope) => developmentIdentity(scope, "socket-host"));
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'matches.host_guests','manual','socket','test','test')",
    [crypto.randomUUID(), host.userId],
  );
  const room = (await lifecycle.create(
    host,
    "guest-create",
    normalizeSettings({ difficulty: "easy", accessMode: "guests_allowed" }),
  )) as { id: string; inviteUrl: string };
  const rawInvite = room.inviteUrl.slice("/invite/".length),
    guestToken = newGuestToken();
  const snapshot = (await invitations.joinGuest(rawInvite, guestToken, "Guest")) as {
    participants: { guest: boolean; userId: string }[];
  };
  const guest = snapshot.participants.find((p) => p.guest)!;
  const readers = {
    sessions: {
      check: async () => {
        throw new Error("unused");
      },
    },
    managed: async () => null,
    guest: (kind: "match" | "interview", hash: string) =>
      run((scope) => guestRepository(scope).lookup(kind, hash)),
  };
  const server = createServer((_req, res) => res.writeHead(404).end());
  servers.push(server);
  stops.push(
    installNodeSockets(server, {
      origins: ["https://example.test"],
      heartbeatMs: 1000,
      resolve: async (request) => {
        const principal = await authenticateGuestRequest(
          request.headers,
          "match",
          async () => {
            throw new IdentityError("unauthorized");
          },
          { lookup: (kind, hash) => readers.guest(kind, hash) },
          { method: "GET", allowedOrigins: ["https://example.test"] },
        );
        if (!principal || principal.kind !== "guest") throw new IdentityError("unauthorized");
        const security = grantSecurity(
          {
            kind: "guest",
            scope: "match",
            resourceId: room.id,
            hash: principal.sessionId,
            expiresAt: principal.credentialExpiresAt,
          },
          readers,
          async (p) => {
            if (!p) throw new IdentityError("unauthorized");
            const match = (await lifecycle.read(p, room.id)) as { version: string };
            return match.version;
          },
        );
        return {
          mode: "match",
          security,
          subscription: {
            subscribe: (notify, lost, signal) =>
              b.subscribe(`/matches/${room.id}`, notify, lost, signal),
          },
          snapshot: matchSocketSnapshot(room.id, lifecycle),
        };
      },
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const base = `ws://127.0.0.1:${addr.port}`;
  const guestWs = await connect(`${base}/guest`, undefined, true, `quorem_guest=${guestToken}`);
  assert.equal((await next(guestWs)).type, "match.updated");
  const denied = new WebSocket(`${base}/guest`, ["quorem", "bearer.invalid"], {
    headers: { Origin: "https://example.test", Cookie: `quorem_guest=${guestToken}` },
  });
  denied.on("error", () => {});
  let opened = false;
  denied.on("open", () => {
    opened = true;
  });
  await new Promise<void>((resolve) => denied.on("close", () => resolve()));
  assert.equal(opened, false);
  const guestClosed = once(guestWs, "close");
  await invitations.removeGuest(host, room.id, guest.userId, "guest-remove");
  await a.publish(`/matches/${room.id}`, {
    id: crypto.randomUUID(),
    aggregateId: room.id,
    version: "0",
    type: "match.updated",
    occurredAt: new Date().toISOString(),
  });
  assert.equal((await guestClosed)[0], 1008);
  await lifecycle.mutate(host, room.id, "guest-close", "leave", null);
});

void test("submission SSE sends only invalidations and enforces ownership", async () => {
  const host = await run((scope) => developmentIdentity(scope, "socket-host")),
    other = await run((scope) => developmentIdentity(scope, "socket-member"));
  const problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID();
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, `socket-${problem}`]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Socket','easy','','{}','[]','{}','test')",
    [version, problem],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
    [workspace, host.userId, version],
  );
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[]')",
    [submission, host.userId, workspace],
  );
  const snapshots = submissionSnapshots(run);
  const app = (principal: typeof host) =>
    createApp({ allowedOrigins: [], requestId: () => "submission" }).route(
      "/",
      submissionRoutes({ snapshots, identify: async () => principal, notices: b }),
    );
  const path = `/v1/submissions/${submission}/events`;
  assert.equal((await app(other).request(path)).status, 404);
  const response = await app(host).request(path);
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  try {
    assert.equal(decoder.decode((await reader.read()).value), "event: changed\ndata: {}\n\n");
    await a.publish(`/submissions/${submission}`, {
      id: crypto.randomUUID(),
      aggregateId: submission,
      version: "1",
      type: "submission.updated",
      occurredAt: new Date().toISOString(),
    });
    assert.equal(decoder.decode((await reader.read()).value), "event: changed\ndata: {}\n\n");
  } finally {
    await reader.cancel();
  }
});
