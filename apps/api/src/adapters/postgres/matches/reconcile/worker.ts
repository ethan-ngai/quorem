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
    "55576",
    "/quorem_hono_match_manifest_test",
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
it("does not decide a match from an unverified terminal result", async () => {
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const id = crypto.randomUUID(),
    owner = crypto.randomUUID(),
    opponent = crypto.randomUUID(),
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name) VALUES(${owner},'A'),(${opponent},'B')`,
      );
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
      await tx.execute(
        sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,${problem}::uuid,1,'T','easy','','{}','[]','{}','test')`,
      );
      await tx.execute(
        sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','runtime','harness','')`,
      );
      await tx.execute(
        sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,deadline,problem_version_id) VALUES(${id}::uuid,${owner},${id},clock_timestamp()+interval '1 hour',30,'active',ARRAY['easy'],clock_timestamp(),clock_timestamp()+interval '1 hour',${version}::uuid)`,
      );
      await tx.execute(
        sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${id}::uuid,${owner},1),(${id}::uuid,${opponent},2)`,
      );
      await tx.execute(
        sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES(${workspace}::uuid,${owner},${version}::uuid,'python','match',${id}::uuid)`,
      );
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,workspace_id,match_id,match_sequence,kind,source,source_hash,state,cases,result) VALUES(${submission}::uuid,${owner},${workspace}::uuid,${id}::uuid,1,'submit','','hash','completed','[]','{"verdict":"accepted","score":{"passed":1,"total":1}}')`,
      );
      await reconcileMatch(tx, id);
      const row = (
        await tx.execute<{ outcome: unknown }>(
          sql`SELECT outcome FROM matches WHERE id=${id}::uuid`,
        )
      ).rows[0];
      expect(row?.outcome).toBeNull();
    }),
  );
});
