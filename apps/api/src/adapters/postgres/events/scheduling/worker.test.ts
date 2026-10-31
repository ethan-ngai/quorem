import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { it, expect } from "vitest";
import { withWorkerConnection } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import { prearmReceipts, consumePrearm } from "./prearm.ts";
it("persists real DO alarms around PostgreSQL receipt activation", async () => {
  const bindings = env as unknown as {
    SCHEDULING_DATABASE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
    };
  };
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(
      bindings.SCHEDULING_DATABASE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      fn,
    );
  const shard = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
      async (tx) => {
        const rows = await tx.execute(
          sql`SELECT mod((('x'||substr(id::text,1,8))::bit(32)::bigint),256) AS shard FROM matches`,
        );
        const occupied = new Set(rows.rows.map((row) => Number(row.shard)));
        return Array.from({ length: 256 }, (_, i) => i).find((i) => !occupied.has(i))!;
      },
    ),
  );
  const receipts = prearmReceipts(run),
    id = crypto.randomUUID();
  await receipts.create(id, shard);
  const stub = bindings.DEADLINES.get(bindings.DEADLINES.idFromName(`deadline-${shard}`));
  await (stub as unknown as { wake(n: number): Promise<void> }).wake(shard);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await receipts.settle(id)).toBe("pending");
  expect(
    await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm()),
  ).not.toBeNull();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      consumePrearm(tx, id, shard),
    ),
  );
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await receipts.settle(id)).toBe("abandoned");
});
it("rearms a future database deadline before acknowledging its committed receipt", async () => {
  const bindings = env as unknown as {
    SCHEDULING_DATABASE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
    };
  };
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(
      bindings.SCHEDULING_DATABASE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      fn,
    );
  const match = crypto.randomUUID(),
    shard = parseInt(match.slice(0, 8), 16) % 256,
    id = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name) VALUES ('scheduler-worker','Scheduler') ON CONFLICT(id) DO NOTHING`,
      );
      await tx.execute(
        sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES (${match}::uuid,'scheduler-worker',${match},clock_timestamp()+interval '1 minute',15,'waiting',ARRAY['easy'])`,
      );
    }),
  );
  const receipts = prearmReceipts(run);
  await receipts.create(id, shard);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      consumePrearm(tx, id, shard),
    ),
  );
  const stub = bindings.DEADLINES.get(bindings.DEADLINES.idFromName(`deadline-${shard}`));
  await (stub as unknown as { wake(n: number): Promise<void> }).wake(shard);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await receipts.settle(id)).toBe("abandoned");
  const next = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
  expect(next).not.toBeNull();
  expect(next!).toBeGreaterThan(Date.now() + 30_000);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`DELETE FROM matches WHERE id=${match}::uuid`);
    }),
  );
});
it("repair rearms a failed alarm without acknowledging its receipt", async () => {
  const bindings = env as unknown as {
    SCHEDULING_DATABASE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
    };
  };
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(
      bindings.SCHEDULING_DATABASE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      fn,
    );
  const match = crypto.randomUUID(),
    shard = parseInt(match.slice(0, 8), 16) % 256,
    id = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name) VALUES ('scheduler-worker','Scheduler') ON CONFLICT(id) DO NOTHING`,
      );
      await tx.execute(
        sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES (${match}::uuid,'scheduler-worker',${match},clock_timestamp()-interval '1 minute',15,'waiting',ARRAY['easy'])`,
      );
    }),
  );
  const receipts = prearmReceipts(run);
  await receipts.create(id, shard);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      consumePrearm(tx, id, shard),
    ),
  );
  const stub = bindings.DEADLINES.get(bindings.DEADLINES.idFromName(`deadline-${shard}`));
  const wake = () => (stub as unknown as { wake(n: number): Promise<void> }).wake(shard);
  await wake();
  await expect(runDurableObjectAlarm(stub)).rejects.toThrow("Fixture has no transition owner");
  expect(await receipts.settle(id)).toBe("committed");
  await wake();
  expect(
    await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm()),
  ).not.toBeNull();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`DELETE FROM matches WHERE id=${match}::uuid`);
    }),
  );
  await receipts.acknowledge(id);
});
