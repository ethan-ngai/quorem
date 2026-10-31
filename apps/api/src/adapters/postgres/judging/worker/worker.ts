/** @file worker.ts @description Native Worker queue fencing against disposable PostgreSQL. @module judging */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { postgresClaims } from "./claim.ts";

it("claims and fences a real attempt through workerd", async () => {
  const url = (env as unknown as { RUNNER_TEST_URL: string }).RUNNER_TEST_URL;
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55464",
    "/quorem_hono_runner_test",
  ]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const user = crypto.randomUUID(),
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    job = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
      await tx.execute(
        sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}','[]',${JSON.stringify({ wallTimeMs: 2000, memoryBytes: 268435456, outputBytes: 65536, maxProcesses: 16, maxCollectionElements: 10000, maxNestingDepth: 100 })}::jsonb,'')`,
      );
      await tx.execute(
        sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','python-3.12-v1','quorem-harness-v2','')`,
      );
      await tx.execute(
        sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${version}::uuid,'python')`,
      );
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${user},${workspace}::uuid,'run','','hash','queued','[]')`,
      );
      await tx.execute(
        sql`INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES(${job}::uuid,${submission}::uuid,'python','python-3.12-v1','quorem-harness-v2')`,
      );
    }),
  );
  try {
    const claims = postgresClaims(run, {
      resumable: true,
      losslessCases: true,
      losslessResults: true,
    });
    const claimed = await claims.claimAfterTeardown(true, "worker-scope", null);
    expect(claimed?.jobId).toBe(job);
    expect(await claims.lease(claimed!, true)).toBe(true);
    expect(await claims.lease({ ...claimed!, sandboxScope: "other" }, false)).toBe(false);
  } finally {
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`DELETE FROM execution_jobs WHERE id=${job}::uuid`);
        await tx.execute(sql`DELETE FROM submissions WHERE id=${submission}::uuid`);
        await tx.execute(sql`DELETE FROM workspaces WHERE id=${workspace}::uuid`);
        await tx.execute(sql`DELETE FROM problem_versions WHERE id=${version}::uuid`);
        await tx.execute(sql`DELETE FROM problems WHERE id=${problem}::uuid`);
        await tx.execute(sql`DELETE FROM users WHERE id=${user}`);
      }),
    );
  }
});
