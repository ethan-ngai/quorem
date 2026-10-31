/** @file private-frame.test.ts @description Fenced PostgreSQL private frame copy. @module interviews */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { savePrivateResultFrame } from "./private-frame.ts";
const url = process.env.QUOREM_RESULTS_TEST_DATABASE_URL;
void test("copies only a live sealed attempt and rejects conflicting rows", async () => {
  if (
    !url ||
    new URL(url).port !== "55465" ||
    new URL(url).pathname !== "/quorem_hono_result_stream_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
  )
    throw new Error("Disposable result database required");
  const pool = createNodePool({
    connectionString: url,
    max: 1,
    connectionTimeoutMs: 1000,
    idleTimeoutMs: 1000,
    onIdleError: (e) => {
      throw e;
    },
  });
  try {
    await withNodeConnection(pool, { lifetimeMs: 10000 }, (scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        for (const query of [
          sql`CREATE TEMP TABLE submissions(id uuid PRIMARY KEY,state text) ON COMMIT DROP`,
          sql`CREATE TEMP TABLE execution_jobs(id uuid PRIMARY KEY,submission_id uuid,attempt_id uuid,sandbox_scope text,finished boolean,lease_until timestamptz) ON COMMIT DROP`,
          sql`CREATE TEMP TABLE execution_completion_staging(job_id uuid,attempt_id uuid,sandbox_scope text,eof boolean) ON COMMIT DROP`,
          sql`CREATE TEMP TABLE execution_completion_frames(job_id uuid,channel text,ordinal int,frame_data bytea) ON COMMIT DROP`,
          sql`CREATE TEMP TABLE interview_private_result_cases(submission_id uuid,ordinal int,result_data bytea,PRIMARY KEY(submission_id,ordinal)) ON COMMIT DROP`,
        ])
          await tx.execute(query);
        const id = crypto.randomUUID(),
          job = crypto.randomUUID(),
          attempt = crypto.randomUUID();
        await tx.execute(sql`INSERT INTO submissions VALUES(${id}::uuid,'running')`);
        await tx.execute(
          sql`INSERT INTO execution_jobs VALUES(${job}::uuid,${id}::uuid,${attempt}::uuid,'scope',false,clock_timestamp()+interval '1 minute')`,
        );
        await tx.execute(
          sql`INSERT INTO execution_completion_staging VALUES(${job}::uuid,${attempt}::uuid,'scope',true)`,
        );
        await tx.execute(
          sql`INSERT INTO execution_completion_frames VALUES(${job}::uuid,'private',0,convert_to('{"index":0}','UTF8'))`,
        );
        await savePrivateResultFrame(tx, id, job, attempt, "scope", 0);
        await savePrivateResultFrame(tx, id, job, attempt, "scope", 0);
        await assert.rejects(
          savePrivateResultFrame(tx, id, job, crypto.randomUUID(), "scope", 0),
          /Missing or conflicting/,
        );
        await tx.execute(
          sql`UPDATE execution_completion_frames SET frame_data=convert_to('{}','UTF8')`,
        );
        await assert.rejects(
          savePrivateResultFrame(tx, id, job, attempt, "scope", 0),
          /Missing or conflicting/,
        );
      }),
    );
  } finally {
    await pool.end();
  }
});
