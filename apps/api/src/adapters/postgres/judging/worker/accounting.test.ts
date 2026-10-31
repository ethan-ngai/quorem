import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { postgresClaims } from "./claim.ts";
import { postgresCompletionStaging } from "./staging.ts";
import { postgresCompletionPromotion } from "./promote.ts";
import type { Completion, Job } from "@quorem/execution";
const url = process.env.QUOREM_RUNNER_TEST_DATABASE_URL;
const parsed = new URL(url ?? "postgres://127.0.0.1:55464/quorem_hono_runner_test");
if (
  parsed.port !== "55464" ||
  parsed.pathname !== "/quorem_hono_runner_test" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
)
  throw new Error("Disposable runner database required");
describe.skipIf(!url)("guest execution metering", () => {
  const pool = createNodePool({
    connectionString: url!,
    max: 8,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
  const claims = postgresClaims(run, {
      resumable: true,
      losslessCases: true,
      losslessResults: true,
    }),
    staging = postgresCompletionStaging(run),
    promote = postgresCompletionPromotion(run);
  const complete = async (job: Job, value: Completion) => {
    await staging.begin(job, {
      ...value,
      publicPresent: !!value.publicCaseResults,
      samplePresent: false,
      privatePresent: false,
      publicCount: value.publicCaseResults?.length ?? 0,
      sampleCount: 0,
      privateCount: 0,
    });
    await staging.eof(job, job);
    await promote(job, job);
  };
  const id = crypto.randomUUID(),
    host = `host-${id}`,
    guest = `guest-${id}`,
    match = crypto.randomUUID(),
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    job = crypto.randomUUID();
  beforeAll(async () => {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    await pool.query(
      "INSERT INTO users(id,display_name,kind) VALUES($1,'Host','account'),($2,'Guest','guest')",
      [host, guest],
    );
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    await pool.query(
      "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','','{}'::jsonb,'[]'::jsonb,$3::jsonb,'')",
      [
        version,
        problem,
        JSON.stringify({
          wallTimeMs: 2000,
          memoryBytes: 268435456,
          outputBytes: 65536,
          maxProcesses: 16,
          maxCollectionElements: 10000,
          maxNestingDepth: 100,
        }),
      ],
    );
    await pool.query(
      "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
      [version],
    );
    await pool.query(
      "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,deadline,problem_version_id) VALUES($1,$2,$1::uuid::text,clock_timestamp()+interval '1 hour',30,'active',ARRAY['easy'],clock_timestamp(),clock_timestamp()+interval '1 hour',$3)",
      [match, host, version],
    );
    await pool.query(
      "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1),($1,$3,2)",
      [match, host, guest],
    );
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,$2,$3,'python','match',$4)",
      [workspace, guest, version, match],
    );
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,match_id) VALUES($1,$2,$3,'run','','hash','queued','[]'::jsonb,$4)",
      [submission, guest, workspace, match],
    );
    await pool.query(
      "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
      [job, submission],
    );
    await pool.query(
      "INSERT INTO guest_execution_usage(submission_id,match_id,sponsor_id) VALUES($1,$2,$3)",
      [submission, match, host],
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM execution_attempt_usage WHERE submission_id=$1", [submission]);
    await pool.query("DELETE FROM guest_execution_usage WHERE submission_id=$1", [submission]);
    await pool.query("DELETE FROM execution_jobs WHERE id=$1", [job]);
    await pool.query("DELETE FROM submissions WHERE id=$1", [submission]);
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace]);
    await pool.query("DELETE FROM match_outbox WHERE match_id=$1", [match]);
    await pool.query("DELETE FROM match_participants WHERE match_id=$1", [match]);
    await pool.query("DELETE FROM matches WHERE id=$1", [match]);
    await pool.query("DELETE FROM users WHERE id=ANY($1)", [[host, guest]]);
    await pool.query("DELETE FROM problem_languages WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.end();
  });
  it("retains the reservation across a retry and settles cumulative attempt usage once", async () => {
    const first = await claims.claimAfterTeardown(true, "scope", null);
    expect(first).not.toBeNull();
    await pool.query(
      "UPDATE execution_jobs SET attempt_started_at=clock_timestamp()-interval '5 seconds' WHERE id=$1",
      [job],
    );
    await complete(first!, {
      submissionId: submission,
      attemptId: first!.attemptId,
      engineFailure: "fixture failure",
    });
    expect(
      (
        await pool.query("SELECT settled_at FROM guest_execution_usage WHERE submission_id=$1", [
          submission,
        ])
      ).rows[0].settled_at,
    ).toBeNull();
    await pool.query(
      "UPDATE execution_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job],
    );
    const second = await claims.claimAfterTeardown(true, "scope", null);
    expect(second).not.toBeNull();
    await promote(first!, first!);
    await complete(second!, {
      submissionId: submission,
      attemptId: second!.attemptId,
      verdict: "accepted",
      publicCaseResults: [],
    });
    const usage = (
      await pool.query(
        "SELECT settled_at,charged_seconds FROM guest_execution_usage WHERE submission_id=$1",
        [submission],
      )
    ).rows[0];
    expect(usage.settled_at).not.toBeNull();
    expect(usage.charged_seconds).toBeGreaterThanOrEqual(5);
    expect(
      Number(
        (
          await pool.query("SELECT count(*) FROM execution_attempt_usage WHERE submission_id=$1", [
            submission,
          ])
        ).rows[0].count,
      ),
    ).toBe(2);
    await promote(second!, second!);
    expect(
      Number(
        (
          await pool.query("SELECT count(*) FROM execution_attempt_usage WHERE submission_id=$1", [
            submission,
          ])
        ).rows[0].count,
      ),
    ).toBe(2);
  });
});
