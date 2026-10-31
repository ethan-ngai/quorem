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
  const response = await app.request("/v1/matches", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "worker-create" },
    body: JSON.stringify({ difficulty: "easy", durationMinutes: 30 }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string };
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
  const create = await app.request("/v1/matches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "create",
      "x-dev-user": host,
    },
    body: JSON.stringify({ difficulty: "easy" }),
  });
  expect(create.status).toBe(201);
  const { id } = (await create.json()) as { id: string };
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
  const ready = (user: string) =>
    app.request(`/v1/matches/${id}/ready`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "ready",
        "x-dev-user": user,
      },
      body: '{"ready":true}',
    });
  const responses = await Promise.all([ready(host), ready(rival)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
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
