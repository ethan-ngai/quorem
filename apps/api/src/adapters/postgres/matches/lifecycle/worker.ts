/** @file worker.ts @description Workerd lifecycle request and durable prearm. @module matches */
import { env, runInDurableObject } from "cloudflare:test";
import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { cloudflareCoordinator } from "../../../scheduling/cloudflare.ts";
import { matchLifecycleRoutes } from "../../../../modules/matches/lifecycle/routes.ts";
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { matchLifecycle } from "./repository.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
it("serves real lifecycle commands with a durable prearmed deadline", async () => {
  const bindings = env as unknown as {
    MATCH_LIFECYCLE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): { wake(n: number): Promise<void> };
    };
  };
  assertRunnerFixture(bindings.MATCH_LIFECYCLE_URL, ["/quorem_hono_lifecycle_test"]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(
      bindings.MATCH_LIFECYCLE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      f,
    );
  const owner = `worker-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(sql`INSERT INTO users(id,display_name,kind) VALUES(${owner},'Worker','account')`),
    ),
  );
  const who = await run((scope) => developmentIdentity(scope, owner));
  const lifecycle = matchLifecycle(run, {
    inviteKey: new Uint8Array(32).fill(3),
    receipts: prearmReceipts(run),
    coordinator: cloudflareCoordinator(bindings.DEADLINES),
    shards: 1,
    guestCreation: true,
  });
  const app = createApp({ allowedOrigins: [], requestId: () => "match-worker" }).route(
    "/",
    matchLifecycleRoutes({ lifecycle, identify: async () => who }),
  );
  const created = (await lifecycle.create(
    who!,
    "worker-create",
    normalizeSettings({ difficulty: "easy", durationMinutes: 30 }),
  )) as { id: string };
  const stub = bindings.DEADLINES.get(bindings.DEADLINES.idFromName("deadline-0"));
  expect(
    await runInDurableObject(stub as never, (_instance, state) => state.storage.getAlarm()),
  ).not.toBeNull();
  const get = await app.request(`/v1/matches/${created.id}`);
  expect(get.status).toBe(200);
  expect(((await get.json()) as { state: string }).state).toBe("waiting");
  const leave = await app.request(`/v1/matches/${created.id}/leave`, {
    method: "POST",
    headers: { "Idempotency-Key": "worker-leave" },
  });
  expect(leave.status).toBe(200);
  expect(((await leave.json()) as { state: string }).state).toBe("cancelled");
});
it("serializes simultaneous ready requests in workerd", async () => {
  const bindings = env as unknown as {
    MATCH_LIFECYCLE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): { wake(n: number): Promise<void> };
    };
  };
  assertRunnerFixture(bindings.MATCH_LIFECYCLE_URL, ["/quorem_hono_lifecycle_test"]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(
      bindings.MATCH_LIFECYCLE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      f,
    );
  const host = `wh-${crypto.randomUUID()}`,
    rival = `wr-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(
        sql`INSERT INTO users(id,display_name,kind) VALUES(${host},'Host','account'),(${rival},'Rival','account')`,
      ),
    ),
  );
  const lifecycle = matchLifecycle(run, {
    inviteKey: new Uint8Array(32).fill(3),
    receipts: prearmReceipts(run),
    coordinator: cloudflareCoordinator(bindings.DEADLINES),
    shards: 1,
    guestCreation: true,
  });
  const app = createApp({ allowedOrigins: [], requestId: () => "match-concurrency" }).route(
    "/",
    matchLifecycleRoutes({
      lifecycle,
      identify: (request) =>
        run((scope) => developmentIdentity(scope, request.headers.get("x-dev-user") ?? "")),
    }),
  );
  const hostWho = (await run((scope) => developmentIdentity(scope, host)))!;
  const rivalWho = (await run((scope) => developmentIdentity(scope, rival)))!;
  const { id } = (await lifecycle.create(
    hostWho,
    "create",
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string };
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${id}::uuid,${rival},2)`,
      );
      await tx.execute(
        sql`INSERT INTO match_reservations(owner_id,match_id) VALUES(${rival},${id}::uuid)`,
      );
    }),
  );
  const responses = await Promise.all([
    lifecycle.mutate(hostWho, id, "ready", "ready", true),
    lifecycle.mutate(rivalWho, id, "ready", "ready", true),
  ]);
  expect(responses).toHaveLength(2);
  const count = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM workspaces WHERE match_id=${id}::uuid`,
          )
        ).rows[0].n,
    ),
  );
  expect(count).toBe(2);
  const finish = await app.request(`/v1/matches/${id}/forfeit`, {
    method: "POST",
    headers: { "Idempotency-Key": "forfeit", "x-dev-user": host },
  });
  expect(finish.status).toBe(200);
});

it("projects live socket leases consistently in workerd HTTP and socket snapshots", async () => {
  const { matchSocketLeases } = await import("../socket/leases.ts");
  const { matchSocketSnapshot } = await import("../../../../modules/events/socket/match.ts");
  const bindings = env as unknown as {
    MATCH_LIFECYCLE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): { wake(n: number): Promise<void> };
    };
  };
  assertRunnerFixture(bindings.MATCH_LIFECYCLE_URL, ["/quorem_hono_lifecycle_test"]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(
      bindings.MATCH_LIFECYCLE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      f,
    );
  const owner = `presence-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${owner},'Worker')`),
    ),
  );
  const who = await run((scope) => developmentIdentity(scope, owner));
  const lifecycle = matchLifecycle(run, {
    inviteKey: new Uint8Array(32).fill(3),
    receipts: prearmReceipts(run),
    coordinator: cloudflareCoordinator(bindings.DEADLINES),
    shards: 1,
    guestCreation: true,
  });
  const app = createApp({ allowedOrigins: [], requestId: () => "presence-worker" }).route(
    "/",
    matchLifecycleRoutes({ lifecycle, identify: async () => who }),
  );
  const { id } = (await lifecycle.create(
    who!,
    "presence-create",
    normalizeSettings({ difficulty: "easy" }),
  )) as { id: string };
  const read = async () =>
    (await (await app.request(`/v1/matches/${id}`)).json()) as {
      version: string;
      participants: { presence: string }[];
    };
  const before = await read();
  expect(before.participants[0].presence).toBe("offline");
  const leases = matchSocketLeases(run),
    first = await leases.acquire(who, id),
    second = await leases.acquire(who, id);
  expect((await read()).participants[0].presence).toBe("online");
  const snapshot = await matchSocketSnapshot(id, lifecycle).read(who, AbortSignal.timeout(5000));
  expect(JSON.parse(snapshot.body).payload.participants[0].presence).toBe("online");
  const ready = (await lifecycle.mutate(who!, id, "presence-ready", "ready", true)) as {
    participants: { presence: string }[];
  };
  expect(ready.participants[0].presence).toBe("online");
  await leases.release(owner, id, first);
  expect((await read()).participants[0].presence).toBe("online");
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(
        sql`UPDATE realtime_presence_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${second}::uuid`,
      ),
    ),
  );
  expect((await read()).participants[0].presence).toBe("offline");
  await leases.release(owner, id, second);
  await app.request(`/v1/matches/${id}/leave`, {
    method: "POST",
    headers: { "idempotency-key": "presence-close" },
  });
});
