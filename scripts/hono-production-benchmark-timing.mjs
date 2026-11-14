/** Read persisted phase boundaries for the public Python benchmark. */
import { createHash } from "node:crypto";

import { createRequire } from "node:module";
import {
  acceptedSource,
  version,
} from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);

/** Read the benchmark's persisted job and sandbox identity without exposing source data. */
export async function benchmarkTimingRows(client, start) {
  if (Number.isNaN(start.valueOf())) throw new Error("Invalid benchmark timestamp");
  const { rows } = await client.query(
    `SELECT i.case_count AS "caseCount", s.admitted_at AS admitted, a.claimed_at AS claimed, a.attempt_id, a.sandbox_scope,
      s.updated_at AS finalized, j.attempts,
      round(1000 * extract(epoch FROM a.claimed_at-s.admitted_at))::int AS "claimMs",
      round(1000 * extract(epoch FROM s.updated_at-a.claimed_at))::int AS "claimToFinalMs"
    FROM submissions s
    JOIN workspaces w ON w.id=s.workspace_id
    JOIN execution_jobs j ON j.submission_id=s.id
    JOIN runner_job_inputs i ON i.job_id=j.id
    LEFT JOIN LATERAL (
      SELECT claimed_at, attempt_id, sandbox_scope FROM execution_attempt_inventory
      WHERE job_id=j.id AND claimed_at>=s.admitted_at ORDER BY claimed_at LIMIT 1
    ) a ON true
    WHERE s.admitted_at >= $1::timestamptz
      AND s.admitted_at < $1::timestamptz + interval '2 minutes'
      AND w.publication_id=$2::uuid AND s.source_hash=$3 AND s.kind='run' AND s.custom_run
      AND j.language='python' AND j.finished AND s.state='completed' AND i.case_count IN (1,5,20)
    ORDER BY s.admitted_at LIMIT 50`,
    [start.toISOString(), version, createHash("sha256").update(acceptedSource).digest("hex")],
  );
  return rows;
}

if (import.meta.main) {
  const start = new Date(process.env.QUOREM_BENCHMARK_START);
  if (Number.isNaN(start.valueOf())) throw new Error("Invalid benchmark timestamp");
  const url = new URL(process.env.DATABASE_URL);
  url.search = "?sslmode=verify-full";
  const client = new Client({
    connectionString: url.href,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const rows = await benchmarkTimingRows(client, start);
    console.log(
      JSON.stringify({
        benchmarkTimings: rows.map(({ attempt_id, sandbox_scope, ...timing }) => timing),
      }),
    );
  } catch (error) {
    console.error(JSON.stringify({ error: "Benchmark timing query failed", code: error.code }));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
