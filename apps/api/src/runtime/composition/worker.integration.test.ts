/// <reference types="@cloudflare/vitest-plugin/types" />
import {
  env,
  SELF,
  runDurableObjectAlarm,
  evictDurableObject,
  runInDurableObject,
} from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
import { newGuestToken, guestTokenHash } from "../../modules/identity/guest/credentials.ts";
import worker, { type Env } from "../worker.ts";
it("runs native auth, catalog, workspace and durable socket through composition", async () => {
  const db = (env as unknown as { DB: { connectionString: string } }).DB.connectionString;
  const parsed = new URL((env as unknown as { DATABASE_CHECK: string }).DATABASE_CHECK);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55575",
    "/quorem_hono_runtime_test",
  ]);
  const user = `worker-${crypto.randomUUID()}`,
    session = crypto.randomUUID(),
    token = crypto.randomUUID(),
    secret = "local-runtime-fixture-secret-32-characters";
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(db, { connectionTimeoutMs: 2000, lifetimeMs: 10000 }, fn);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`DELETE FROM quorem_auth.rate_limit`);
      await tx.execute(
        sql`INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES(${user},${user},${user + "@example.test"},true,NOW(),NOW())`,
      );
      await tx.execute(
        sql`INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES(${session},${token},${user},NOW()+interval '1 hour',NOW(),NOW())`,
      );
    }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
  );
  const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...signed))}`)}`;
  const health = await SELF.fetch("http://127.0.0.1:8765/health", {
    headers: { origin: "http://127.0.0.1:5173" },
  });
  expect(health.status).toBe(200);
  expect(health.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  const auth = await SELF.fetch("http://127.0.0.1:8765/api/auth/token", {
    headers: { cookie, origin: "http://127.0.0.1:5173" },
  });
  expect(auth.status).toBe(200);
  const bearer = ((await auth.json()) as { token: string }).token;
  const catalog = await SELF.fetch("http://127.0.0.1:8765/v1/problems");
  expect(catalog.status).toBe(200);
  for (let i = 0; i < 20; i++) {
    const authorized = await SELF.fetch("http://127.0.0.1:8765/v1/problems", {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(authorized.status).toBe(200);
    await authorized.body?.cancel();
  }
  const workspace = await SELF.fetch("http://127.0.0.1:8765/v1/workspaces", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      language: "python",
    }),
  });
  expect(workspace.status).toBe(201);
  const workspaceId = ((await workspace.json()) as { id: string }).id;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) SELECT ${crypto.randomUUID()}::uuid,b.user_id,'interviews.host','manual','fixture','fixture','fixture' FROM identity_bindings b WHERE b.issuer='http://127.0.0.1:8765' AND b.subject=${user}`,
      ),
    ),
  );
  const headers = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    "idempotency-key": "worker-runtime-room",
  };
  const created = await SELF.fetch("http://127.0.0.1:8765/v1/interviews", {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Runtime",
      question: { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const room = ((await created.json()) as { id: string }).id;
  const snapshot = await SELF.fetch(`http://127.0.0.1:8765/v1/interviews/${room}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  expect(snapshot.status).toBe(200);
  const value = (await snapshot.json()) as { document: { epoch: string; source: string } };
  const push = await SELF.fetch(`http://127.0.0.1:8765/v1/interviews/${room}/updates`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "worker-runtime-push" },
    body: JSON.stringify({
      epoch: value.document.epoch,
      version: 0,
      updates: [{ clientID: "runtime", changes: [[0, "🦊"], value.document.source.length] }],
    }),
  });
  expect(push.status, await push.clone().text()).toBe(200);
  const interviewUpgrade = await SELF.fetch(`http://127.0.0.1:8765/v1/interviews/${room}/events`, {
    headers: {
      upgrade: "websocket",
      origin: "http://127.0.0.1:5173",
      "sec-websocket-protocol": `quorem,bearer.${bearer}`,
    },
  });
  expect(interviewUpgrade.status).toBe(101);
  const interviewSocket = interviewUpgrade.webSocket!;
  let initialResolve!: () => void, commandResolve!: (value: unknown) => void;
  const interviewInitial = new Promise<void>((resolve) => {
    initialResolve = resolve;
  });
  const interviewResult = new Promise<unknown>((resolve) => {
    commandResolve = resolve;
  });
  interviewSocket.addEventListener("message", (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data)) as {
      receipt?: string;
      payload?: { id?: string; type?: string };
    };
    if (frame.receipt) interviewSocket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
    if (frame.payload?.type === "changed") initialResolve();
    if (frame.payload?.id === "socket-push") commandResolve(frame.payload);
  });
  interviewSocket.accept();
  await interviewInitial;
  const directNamespace = (
    env as unknown as {
      SOCKETS: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(request: Request): Promise<Response> };
      };
    }
  ).SOCKETS;
  const forgedScope = await directNamespace
    .get(directNamespace.idFromName(`socket:interview:${room}`))
    .fetch(
      new Request(`http://127.0.0.1:8765/v1/interviews/${room}/events`, {
        headers: {
          upgrade: "websocket",
          origin: "http://127.0.0.1:5173",
          "sec-websocket-protocol": `quorem,bearer.${bearer}`,
          "x-quorem-socket-scope": crypto.randomUUID(),
        },
      }),
    );
  expect(forgedScope.status).toBe(401);
  const peerUpgrade = await SELF.fetch(
    `http://127.0.0.1:8765/v1/interviews/${room.toUpperCase()}/events`,
    {
      headers: {
        upgrade: "websocket",
        origin: "http://127.0.0.1:5173",
        "sec-websocket-protocol": `quorem,bearer.${bearer}`,
        "x-quorem-socket-scope": crypto.randomUUID(),
      },
    },
  );
  expect(peerUpgrade.status).toBe(101);
  const peer = peerUpgrade.webSocket!;
  let initialPeer!: () => void,
    updatePeer!: () => void,
    changes = 0;
  const peerReady = new Promise<void>((resolve) => {
    initialPeer = resolve;
  });
  const peerChanged = new Promise<void>((resolve) => {
    updatePeer = resolve;
  });
  peer.addEventListener("message", (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data)) as {
      receipt?: string;
      payload?: { type?: string };
    };
    if (frame.receipt) peer.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
    if (frame.payload?.type === "changed") {
      changes++;
      if (changes === 1) initialPeer();
      else updatePeer();
    }
  });
  peer.accept();
  await peerReady;
  const updated = await SELF.fetch(`http://127.0.0.1:8765/v1/interviews/${room}/document`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const document = (await updated.json()) as { epoch: string; version: number; source: string };
  interviewSocket.send(
    JSON.stringify({
      id: "socket-push",
      type: "push",
      key: "socket-push-key",
      push: {
        epoch: document.epoch,
        version: document.version,
        updates: [{ clientID: "runtime-socket", changes: [[0, "z"], document.source.length] }],
      },
    }),
  );
  expect(
    await Promise.race([
      interviewResult,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("socket command timeout")), 8000),
      ),
    ]),
  ).toBeTruthy();
  await Promise.race([
    peerChanged,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("peer notice timeout")), 8000),
    ),
  ]);
  peer.close();
  {
    const namespaces = (
      env as unknown as {
        SOCKETS: {
          idFromName(name: string): unknown;
          get(id: unknown): Parameters<typeof evictDurableObject>[0];
        };
      }
    ).SOCKETS;
    const interviewStub = namespaces.get(namespaces.idFromName(`socket:interview:${room}`));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await Promise.race([
      evictDurableObject(interviewStub),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("interview eviction timeout")), 5000),
      ),
    ]);
    const resumed = new Promise<void>((resolve) =>
      interviewSocket.addEventListener("message", () => resolve(), { once: true }),
    );
    expect(await runDurableObjectAlarm(interviewStub)).toBe(true);
    await resumed;
  }
  interviewSocket.close();

  const invite = newGuestToken(),
    inviteHash = await guestTokenHash(invite),
    matchId = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(
        sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) SELECT ${matchId}::uuid,b.user_id,${inviteHash},clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'] FROM identity_bindings b WHERE b.issuer='http://127.0.0.1:8765' AND b.subject=${user}`,
      ),
    ),
  );
  const inviteURL = `http://127.0.0.1:8765/v1/match-invites/${invite}/events`;
  const forbidden = await SELF.fetch(inviteURL, {
    headers: {
      upgrade: "websocket",
      origin: "https://evil.test",
      "sec-websocket-protocol": "quorem",
    },
  });
  expect(forbidden.status).toBe(403);
  const inviteUpgrade = await SELF.fetch(inviteURL, {
    headers: {
      upgrade: "websocket",
      origin: "http://127.0.0.1:5173",
      "sec-websocket-protocol": "quorem",
      "x-quorem-socket-scope": crypto.randomUUID(),
    },
  });
  expect(inviteUpgrade.status).toBe(101);
  const inviteSocket = inviteUpgrade.webSocket!;
  const firstInvite = new Promise<void>((resolve) =>
    inviteSocket.addEventListener(
      "message",
      (event: MessageEvent) => {
        const frame = JSON.parse(String(event.data)) as { receipt?: string };
        if (frame.receipt)
          inviteSocket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
        resolve();
      },
      { once: true },
    ),
  );
  inviteSocket.accept();
  await firstInvite;
  const inviteNamespace = (
    env as unknown as {
      SOCKETS: {
        idFromName(name: string): unknown;
        get(id: unknown): Parameters<typeof runInDurableObject>[0];
      };
    }
  ).SOCKETS;
  const inviteStub = inviteNamespace.get(inviteNamespace.idFromName(`socket:match:${matchId}`));
  const attachments = await runInDurableObject(inviteStub, (_instance, state) =>
    state
      .getWebSockets()
      .map((socket: { deserializeAttachment(): unknown }) => socket.deserializeAttachment()),
  );
  expect(attachments).toHaveLength(1);
  expect(JSON.stringify(attachments)).not.toContain(invite);
  inviteSocket.close();

  const admitted = await SELF.fetch("http://127.0.0.1:8765/v1/submissions", {
    method: "POST",
    headers: { ...headers, "idempotency-key": "worker-runtime-run" },
    body: JSON.stringify({
      workspaceId,
      kind: "run",
      source: "class Solution:\n def runWidths(self, values): return []\n",
    }),
  });
  expect(admitted.status, await admitted.clone().text()).toBe(202);
  const submission = ((await admitted.json()) as { id: string }).id;
  const cancelled = await SELF.fetch(`http://127.0.0.1:8765/v1/submissions/${submission}/cancel`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "worker-runtime-cancel" },
    body: "{}",
  });
  expect(cancelled.status, await cancelled.clone().text()).toBe(200);
  const count = async () =>
    run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          Number(
            (
              await tx.execute<{ n: string }>(
                sql`SELECT count(*)::text AS n FROM submissions WHERE workspace_id=${workspaceId}::uuid`,
              )
            ).rows[0].n,
          ),
      ),
    );
  const before = await count();
  const failing = {
    ...(env as unknown as Env),
    EXECUTION_QUEUE: {
      send: async () => {
        throw new Error("fixture unavailable");
      },
    },
  };
  const rejected = await worker.fetch(
    new Request("http://127.0.0.1:8765/v1/submissions", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "worker-provider-failure" },
      body: JSON.stringify({ workspaceId, kind: "run", source: "class Solution: pass" }),
    }),
    failing,
  );
  expect(rejected.status).toBe(503);
  expect(await count()).toBe(before);

  const upgraded = await SELF.fetch("http://127.0.0.1:8765/v1/memberships/events", {
    headers: {
      upgrade: "websocket",
      origin: "http://127.0.0.1:5173",
      "sec-websocket-protocol": `quorem,bearer.${bearer}`,
    },
  });
  expect(upgraded.status).toBe(101);
  const socket = upgraded.webSocket!;
  const initial = new Promise<void>((resolve) =>
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as { receipt?: string };
      if (message.receipt) socket.send(JSON.stringify({ type: "receipt", id: message.receipt }));
      resolve();
    }),
  );
  socket.accept();
  await initial;
  const namespace = (
    env as unknown as {
      SOCKETS: {
        idFromName(name: string): unknown;
        get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
      };
    }
  ).SOCKETS;
  const participant = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
      async (tx) =>
        (
          await tx.execute<{ participant: string }>(
            sql`SELECT u.participant_id::text AS participant FROM users u JOIN identity_bindings b ON b.user_id=u.id WHERE b.issuer='http://127.0.0.1:8765' AND b.subject=${user}`,
          )
        ).rows[0].participant,
    ),
  );
  const socketStub = namespace.get(namespace.idFromName(`socket:membership:${participant}`));
  await new Promise((resolve) => setTimeout(resolve, 200));
  await Promise.race([
    evictDurableObject(socketStub),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("eviction timeout")), 5000),
    ),
  ]);
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (event: CloseEvent) => resolve(event.code), { once: true }),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(sql`DELETE FROM quorem_auth."session" WHERE id=${session}`),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 2100));
  expect(
    await Promise.race([
      runDurableObjectAlarm(socketStub),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("alarm timeout")), 5000)),
    ]),
  ).toBe(true);
  expect(
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("close timeout")), 5000)),
    ]),
  ).toBe(1008);
  const revoked = await SELF.fetch("http://127.0.0.1:8765/v1/workspaces", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
      language: "python",
    }),
  });
  expect(revoked.status).toBe(401);
});
