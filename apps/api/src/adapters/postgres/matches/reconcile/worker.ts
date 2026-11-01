/** @file worker.ts @description Workerd match reconciliation on PostgreSQL. @module matches */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { reconcileMatch, reconcileScheduledMatch } from "./repository.ts";
const url = (env as unknown as { MATCH_TEST_URL: string }).MATCH_TEST_URL;
it("reconciles an expired invitation once with real PostgreSQL", async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55461",
    "/quorem_hono_match_test",
  ]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const id = crypto.randomUUID(),
    owner = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${owner},'Worker')`);
      await tx.execute(
        sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES(${id}::uuid,${owner},${id},clock_timestamp()-interval '1 second',30,'waiting',ARRAY['easy'])`,
      );
      await tx.execute(
        sql`INSERT INTO match_reservations(owner_id,match_id) VALUES(${owner},${id}::uuid)`,
      );
    }),
  );
  for (let n = 0; n < 2; n++)
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
        reconcileMatch(tx, id),
      ),
    );
  const row = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      const match = (
        await tx.execute<{ state: string; version: string }>(
          sql`SELECT state,version::text FROM matches WHERE id=${id}::uuid`,
        )
      ).rows[0];
      const notices = (
        await tx.execute(
          sql`SELECT id FROM match_outbox WHERE match_id=${id}::uuid AND event_type='match.completed'`,
        )
      ).rows.length;
      const reservations = (
        await tx.execute(sql`SELECT owner_id FROM match_reservations WHERE match_id=${id}::uuid`)
      ).rows.length;
      return { match, notices, reservations };
    }),
  );
  expect(row).toEqual({ match: { state: "cancelled", version: "1" }, notices: 1, reservations: 0 });
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      reconcileScheduledMatch(tx, crypto.randomUUID(), "1"),
    ),
  );
});
