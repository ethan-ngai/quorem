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
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { guestTokenHash, newGuestToken } from "../../../modules/identity/guest/credentials.ts";
const database = (env as unknown as { DATABASE: string }).DATABASE;
const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
  withWorkerConnection(database, { lifetimeMs: 5000, connectionTimeoutMs: 2000 }, f);
it.skipIf(!database)("upgrades and revokes an actual invite against PostgreSQL", async () => {
  const parsed = new URL(database);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55473",
    "/quorem_hono_do_sockets_test",
  ]);
  const host = `do-${crypto.randomUUID()}`,
    id = crypto.randomUUID(),
    token = newGuestToken(),
    hash = await guestTokenHash(token);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'DO host')`);
      await tx.execute(
        sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES(${id}::uuid,${host},${hash},clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])`,
      );
    }),
  );
  const response = await SELF.fetch(`https://worker.test/v1/match-invites/${token}/events`, {
    headers: {
      upgrade: "websocket",
      origin: "https://example.test",
      "sec-websocket-protocol": "quorem",
      "x-fixture-invitation": token,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const frame = await new Promise<string>((resolve) =>
    socket.addEventListener("message", (event: MessageEvent) => resolve(String(event.data)), {
      once: true,
    }),
  );
  const message = JSON.parse(frame) as { receipt: string; payload: unknown };
  expect(message.payload).toEqual({ type: "changed" });
  socket.send(JSON.stringify({ type: "receipt", id: message.receipt }));
  socket.addEventListener("message", (event: MessageEvent) => {
    const envelope = JSON.parse(String(event.data)) as { receipt: string };
    socket.send(JSON.stringify({ type: "receipt", id: envelope.receipt }));
  });
  const namespace = (
    env as unknown as {
      SOCKET: {
        idFromName(name: string): unknown;
        get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
      };
    }
  ).SOCKET;
  const stub = namespace.get(namespace.idFromName("fixture"));
  const attached = await runInDurableObject(stub, (_instance, state) =>
    state
      .getWebSockets()
      .map((ws: { deserializeAttachment(): unknown }) => ws.deserializeAttachment()),
  );
  expect(attached).toHaveLength(1);
  expect(Object.keys(attached[0])).toEqual(["id"]);
  expect(JSON.stringify(attached)).not.toContain(token);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await evictDurableObject(stub);
  const resumed = new Promise<string>((resolve) =>
    socket.addEventListener("message", (event: MessageEvent) => resolve(String(event.data)), {
      once: true,
    }),
  );
  await runDurableObjectAlarm(stub);
  expect(["changed", "heartbeat"]).toContain(JSON.parse(await resumed).payload.type);
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (event: CloseEvent) => resolve(event.code), { once: true }),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE matches SET invite_hash=${crypto.randomUUID()} WHERE id=${id}::uuid`,
      );
    }),
  );
  await runDurableObjectAlarm(stub);
  expect(await closed).toBe(1008);
});

it.skipIf(!database)(
  "shares the canonical interview lease quota across two Durable Objects",
  async () => {
    const { SignJWT } = await import("jose");
    const host = `do-host-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      doc = crypto.randomUUID(),
      epoch = crypto.randomUUID();
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'DO host')`);
        await tx.execute(
          sql`INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('socket-test',${host},${host})`,
        );
        await tx.execute(
          sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${host},'interviews.host','manual','test','test','test')`,
        );
        await tx.execute(
          sql`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES(${id}::uuid,${host},'DO','{}'::jsonb,'python','',${doc}::uuid,${epoch}::uuid,${crypto.randomUUID()},'token',${crypto.randomUUID()},'token2')`,
        );
        await tx.execute(
          sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${id}::uuid,${host},'interviewer')`,
        );
      }),
    );
    const token = await new SignJWT({ sid: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("socket-test")
      .setSubject(host)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("0123456789abcdef0123456789abcdef"));
    const shards = [crypto.randomUUID(), crypto.randomUUID()],
      sockets: WebSocket[] = [],
      frames: { id?: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await SELF.fetch(
        `https://worker.test/v1/interviews/${id}/events?shard=${shards[i % 2]}`,
        {
          headers: {
            upgrade: "websocket",
            origin: "https://example.test",
            "sec-websocket-protocol": `quorem,bearer.${token}`,
          },
        },
      );
      if (i === 4) {
        expect(response.status).toBe(429);
        break;
      }
      expect(response.status).toBe(101);
      const socket = response.webSocket!;
      socket.accept();
      socket.addEventListener("message", (event: MessageEvent) => {
        const frame = JSON.parse(String(event.data));
        if (i === 0) frames.push(frame.payload);
        socket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
      });
      sockets.push(socket);
    }
    const count = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ count: string }>(
              sql`SELECT count(*)::text AS count FROM realtime_presence_leases WHERE topic=${`/interviews/${id}`} AND subject=${host} AND expires_at>clock_timestamp()`,
            )
          ).rows[0].count,
      ),
    );
    expect(count).toBe("4");
    let unlock!: () => void, locked!: () => void;
    const released = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holding = run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`SELECT id FROM interviews WHERE id=${id}::uuid FOR NO KEY UPDATE`);
        locked();
        await released;
      }),
    );
    await ready;
    try {
      sockets[0].send(
        JSON.stringify({
          id: "push-one",
          type: "push",
          key: "retry-key-123",
          push: { epoch: doc, version: 0, updates: [{ clientID: "client", changes: [[0, "x"]] }] },
        }),
      );
      sockets[0].send(JSON.stringify({ id: "peers-one", type: "peers" }));
      for (let n = 0; !frames.some((frame) => frame.id === "peers-one") && n < 60; n++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(frames.some((frame) => frame.id === "peers-one")).toBe(true);
      expect(frames.some((frame) => frame.id === "push-one")).toBe(false);
      const namespace = (
        env as unknown as {
          SOCKET: {
            idFromName(name: string): unknown;
            get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
          };
        }
      ).SOCKET;
      await runDurableObjectAlarm(namespace.get(namespace.idFromName(shards[0])));
    } finally {
      unlock();
      await holding;
    }
    for (let n = 0; !frames.some((frame) => frame.id === "push-one") && n < 100; n++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(frames.some((frame) => frame.id === "push-one")).toBe(true);
    const firstLease = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ id: string }>(
              sql`SELECT id::text FROM realtime_presence_leases WHERE topic=${`/interviews/${id}`} AND subject=${host} LIMIT 1`,
            )
          ).rows[0].id,
      ),
    );
    const { releaseInterviewLease } =
      await import("../../../adapters/postgres/interviews/presence/repository.ts");
    await releaseInterviewLease(run, id, "other-owner", firstLease);
    await releaseInterviewLease(run, crypto.randomUUID(), host, firstLease);
    const remaining = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ count: string }>(
              sql`SELECT count(*)::text AS count FROM realtime_presence_leases WHERE id=${firstLease}::uuid`,
            )
          ).rows[0].count,
      ),
    );
    expect(remaining).toBe("1");
    const closed = sockets.map(
      (socket) =>
        new Promise<number>((resolve) =>
          socket.addEventListener("close", (event: CloseEvent) => resolve(event.code), {
            once: true,
          }),
        ),
    );
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=${id}::uuid AND user_id=${host}`,
        );
      }),
    );
    const namespace = (
      env as unknown as {
        SOCKET: {
          idFromName(name: string): unknown;
          get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
        };
      }
    ).SOCKET;
    await Promise.all(
      shards.map((shard) => runDurableObjectAlarm(namespace.get(namespace.idFromName(shard)))),
    );
    expect(await Promise.all(closed)).toEqual([1008, 1008, 1008, 1008]);
    for (let attempt = 0; attempt < 100; attempt++) {
      const n = await run((scope) =>
        scope.transaction(
          { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
          async (tx) =>
            (
              await tx.execute<{ count: string }>(
                sql`SELECT count(*)::text AS count FROM realtime_presence_leases WHERE topic=${`/interviews/${id}`} AND subject=${host}`,
              )
            ).rows[0].count,
        ),
      );
      if (n === "0") break;
      if (attempt === 99) throw new Error("Lease cleanup did not finish");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await releaseInterviewLease(run, id, host, firstLease);
  },
);

it.skipIf(!database)(
  "closes a stalled reader after one frame while coalescing notices",
  async () => {
    const host = `stall-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      token = newGuestToken(),
      hash = await guestTokenHash(token),
      shard = crypto.randomUUID();
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'DO host')`);
        await tx.execute(
          sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES(${id}::uuid,${host},${hash},clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])`,
        );
      }),
    );
    const response = await SELF.fetch(
      `https://worker.test/v1/match-invites/${token}/events?shard=${shard}`,
      {
        headers: {
          upgrade: "websocket",
          origin: "https://example.test",
          "sec-websocket-protocol": "quorem",
          "x-fixture-invitation": token,
        },
      },
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    let count = 0;
    const first = new Promise<void>((resolve) =>
      socket.addEventListener("message", () => {
        count++;
        resolve();
      }),
    );
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event: CloseEvent) => resolve(event.code), { once: true }),
    );
    await first;
    const namespace = (
      env as unknown as {
        SOCKET: {
          idFromName(name: string): unknown;
          get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
        };
      }
    ).SOCKET;
    const stub = namespace.get(namespace.idFromName(shard));
    await runInDurableObject(stub, async (instance) => {
      const target = instance as unknown as {
        publish(notice: {
          id: string;
          aggregateId: string;
          version: string;
          type: string;
          occurredAt: string;
        }): Promise<void>;
      };
      for (let i = 0; i < 100; i++)
        await target.publish({
          id: crypto.randomUUID(),
          aggregateId: id,
          version: String(i),
          type: "match.updated",
          occurredAt: "",
        });
    });
    expect(await closed).toBe(1013);
    expect(count).toBe(1);
  },
);

it.skipIf(!database)(
  "rejects untrusted origins, forged credentials and mismatched resources",
  async () => {
    const { assertRunnerFixture } =
      await import("../../../adapters/postgres/judging/worker/test-db.ts");
    assertRunnerFixture(database!, ["/quorem_hono_do_sockets_test"]);
    const { SignJWT } = await import("jose");
    const host = `authority-${crypto.randomUUID()}`,
      id = crypto.randomUUID(),
      other = crypto.randomUUID();
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'Authority')`);
        await tx.execute(
          sql`INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('socket-test',${host},${host})`,
        );
        await tx.execute(
          sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES(${id}::uuid,${host},${crypto.randomUUID()},clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])`,
        );
        await tx.execute(
          sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${id}::uuid,${host},1)`,
        );
      }),
    );
    const signed = (key: string, expiration: string) =>
      new SignJWT({ sid: "session" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("socket-test")
        .setSubject(host)
        .setExpirationTime(expiration)
        .sign(new TextEncoder().encode(key));
    const good = await signed("0123456789abcdef0123456789abcdef", "5m"),
      forged = await signed("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "5m"),
      expired = await signed("0123456789abcdef0123456789abcdef", "-1s");
    const connect = (resource: string, token: string, origin = "https://example.test") =>
      SELF.fetch(`https://worker.test/v1/matches/${resource}/events?shard=${crypto.randomUUID()}`, {
        headers: {
          upgrade: "websocket",
          origin,
          "sec-websocket-protocol": `quorem,bearer.${token}`,
        },
      });
    expect((await connect(id, good, "https://evil.test")).status).toBe(403);
    expect((await connect(id, forged)).status).toBe(401);
    expect((await connect(id, expired)).status).toBe(401);
    expect((await connect(other, good)).status).toBe(404);
    const ok = await connect(id, good);
    expect(ok.status).toBe(101);
    const socket = ok.webSocket!;
    socket.accept();
    const message = await new Promise<string>((resolve) =>
      socket.addEventListener("message", (event: MessageEvent) => resolve(String(event.data)), {
        once: true,
      }),
    );
    const envelope = JSON.parse(message);
    expect(envelope.payload).toMatchObject({ type: "match.updated", aggregateId: id });
    expect(envelope.payload.payload.participants[0]).toMatchObject({ presence: "online" });
    expect(envelope.payload.payload.participants[0].userId).not.toBe(host);
    socket.send(JSON.stringify({ type: "receipt", id: envelope.receipt }));
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
);

it.skipIf(!database)("rehydrates guest scope and closes after guest revocation", async () => {
  const host = `guest-host-${crypto.randomUUID()}`,
    guest = `guest-${crypto.randomUUID()}`,
    id = crypto.randomUUID(),
    token = newGuestToken(),
    hash = await guestTokenHash(token),
    shard = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'Host')`);
      await tx.execute(
        sql`INSERT INTO users(id,display_name,kind) VALUES(${guest},'Guest','guest')`,
      );
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${host},'interviews.host','manual','test','test','test')`,
      );
      await tx.execute(
        sql`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES(${id}::uuid,${host},'Guest','{}'::jsonb,'python','',${crypto.randomUUID()}::uuid,${crypto.randomUUID()}::uuid,${crypto.randomUUID()},'token',${crypto.randomUUID()},'token2')`,
      );
      await tx.execute(
        sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${id}::uuid,${guest},'interviewee')`,
      );
      await tx.execute(
        sql`INSERT INTO interview_guest_sessions(token_hash,owner_id,session_id,expires_at) VALUES(${hash},${guest},${id}::uuid,clock_timestamp()+interval '1 hour')`,
      );
    }),
  );
  const response = await SELF.fetch(
    `https://worker.test/v1/interviews/${id}/events?shard=${shard}`,
    {
      headers: {
        upgrade: "websocket",
        origin: "https://example.test",
        "sec-websocket-protocol": "quorem",
        cookie: `quorem_interview_guest=${token}`,
      },
    },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  socket.addEventListener("message", (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data));
    socket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
  });
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (event: CloseEvent) => resolve(event.code), { once: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE interview_guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=${hash}`,
      );
    }),
  );
  const namespace = (
    env as unknown as {
      SOCKET: {
        idFromName(name: string): unknown;
        get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
      };
    }
  ).SOCKET;
  await runDurableObjectAlarm(namespace.get(namespace.idFromName(shard)));
  expect(await closed).toBe(1008);
});

it.skipIf(!database)("routes membership notices using the public participant key", async () => {
  const { SignJWT } = await import("jose");
  const user = `member-${crypto.randomUUID()}`,
    shard = crypto.randomUUID();
  const participant = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`INSERT INTO users(id,display_name) VALUES(${user},'Member') RETURNING participant_id::text AS id`,
          )
        ).rows[0].id,
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('socket-test',${user},${user})`,
      );
    }),
  );
  const token = await new SignJWT({ sid: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("socket-test")
    .setSubject(user)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode("0123456789abcdef0123456789abcdef"));
  const response = await SELF.fetch(`https://worker.test/v1/memberships/events?shard=${shard}`, {
    headers: {
      upgrade: "websocket",
      origin: "https://example.test",
      "sec-websocket-protocol": `quorem,bearer.${token}`,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  const events: unknown[] = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data));
    events.push(frame.payload);
    socket.send(JSON.stringify({ type: "receipt", id: frame.receipt }));
  });
  for (let n = 0; events.length < 1 && n < 100; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual([{ type: "membership.updated" }]);
  const namespace = (
    env as unknown as {
      SOCKET: {
        idFromName(name: string): unknown;
        get(id: unknown): { publish(notice: unknown): Promise<void> };
      };
    }
  ).SOCKET;
  await namespace.get(namespace.idFromName(shard)).publish({
    id: crypto.randomUUID(),
    aggregateId: participant,
    version: "1",
    type: "membership.updated",
    occurredAt: "",
  });
  for (let n = 0; events.length < 2 && n < 100; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual([{ type: "membership.updated" }, { type: "membership.updated" }]);
  socket.close();
});
