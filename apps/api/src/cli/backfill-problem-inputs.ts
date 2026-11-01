/** @file backfill-problem-inputs.ts @description Audited legacy problem-version runner indexing. @module cli */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { indexRunnerFixture } from "../adapters/postgres/judging/inputs/fixture.ts";
import { verifiedOperator } from "./operator-backfill.ts";

class DryRun extends Error {}
export class ProblemInputsIncomplete extends Error {
  readonly completed: number;
  readonly dryRun: boolean;
  constructor(completed: number, dryRun: boolean) {
    super("Problem input backfill incomplete");
    this.completed = completed;
    this.dryRun = dryRun;
  }
}

/** Operator assertion must follow independent shutdown of legacy writers and judges. */
export async function backfillProblemInputs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      "op-id": { type: "string" },
      reason: { type: "string" },
      limit: { type: "string", default: "16" },
      "max-batches": { type: "string", default: "100" },
      "dry-run": { type: "boolean", default: false },
      "legacy-drained": { type: "boolean", default: false },
    },
  });
  if (
    !values["op-id"] ||
    !values.reason ||
    !/^[1-9]\d*$/.test(values.limit!) ||
    !/^[1-9]\d*$/.test(values["max-batches"]!)
  )
    throw new Error("Operation, reason and batch bounds required");
  const limit = Number(values.limit),
    batches = Number(values["max-batches"]);
  if (
    !Number.isSafeInteger(limit) ||
    limit > 64 ||
    !Number.isSafeInteger(batches) ||
    batches > 1000
  )
    throw new Error("Invalid batch bounds");
  if (!values["dry-run"] && !values["legacy-drained"])
    throw new Error("Drain legacy writers and judges before backfill");
  const url = process.env.QUOREM_OPERATOR_DATABASE_URL,
    issuer = process.env.AUTH_ORIGIN;
  if (!url || !issuer) throw new Error("Operator database and issuer required");
  const pool = createNodePool({
    connectionString: url,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withNodeConnection(pool, { lifetimeMs: 300000 }, fn);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ reason: values.reason, limit, batches, drained: values["legacy-drained"] }),
    )
    .digest("hex");
  let completed = 0,
    after: string | null = null,
    complete = false;
  try {
    const actor = await run<string>((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        const actor = await verifiedOperator(tx, issuer);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${values["op-id"]!},740099))`,
        );
        const prior = (
          await tx.execute<{ actor: string; action: string; scope: string }>(
            sql`SELECT actor,action,scope FROM access_audit WHERE operation_id=${values["op-id"]!}`,
          )
        ).rows[0];
        if (
          prior &&
          (prior.actor !== actor ||
            prior.action !== "problems.runner-inputs.backfill" ||
            prior.scope !== fingerprint)
        )
          throw new Error("Operation ID already used");
        if (!values["dry-run"] && !prior)
          await tx.execute(
            sql`INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES(${values["op-id"]!},${actor},${actor},'problems.runner-inputs.backfill',${fingerprint},${values.reason!})`,
          );
        return actor;
      }),
    );
    for (let batch = 0; batch < batches; batch++) {
      const ids = await run<string[]>((scope) =>
        scope.transaction(
          { readOnly: true, statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
          async (tx) =>
            (
              await tx.execute<{ id: string }>(
                sql`SELECT v.id::text AS id FROM problem_versions v WHERE v.sealed AND (${after}::uuid IS NULL OR v.id>${after}::uuid) AND NOT EXISTS (SELECT 1 FROM runner_version_inputs i WHERE i.version_id=v.id AND i.sealed) ORDER BY v.id LIMIT ${limit}`,
              )
            ).rows.map((r) => r.id),
        ),
      );
      if (!ids.length) {
        complete = true;
        break;
      }
      for (const id of ids) {
        try {
          await run((scope) =>
            scope.transaction({ statementTimeoutMs: 120000, lockTimeoutMs: 1000 }, async (tx) => {
              if ((await verifiedOperator(tx, issuer)) !== actor)
                throw new Error("Operator changed");
              const size = (
                await tx.execute<{ bytes: number; cases: number }>(
                  sql`SELECT (COALESCE(octet_length(v.lossless_fixture),0) + octet_length(COALESCE(v.odyssey::text,'')) + octet_length(COALESCE(v.signature::text,'')) + octet_length(COALESCE(v.constraints::text,'')) + octet_length(COALESCE(v.limits::text,'')) + octet_length(COALESCE(v.sql_config::text,'')) + COALESCE((SELECT sum(octet_length(row_to_json(e)::text)) FROM problem_examples e WHERE e.version_id=v.id),0) + COALESCE((SELECT sum(octet_length(row_to_json(c)::text)) FROM problem_test_cases c WHERE c.version_id=v.id),0) + COALESCE((SELECT sum(octet_length(c.case_data::text)) FROM problem_odyssey_cases c WHERE c.version_id=v.id),0))::bigint AS bytes, ((SELECT count(*) FROM problem_examples e WHERE e.version_id=v.id) + (SELECT count(*) FROM problem_test_cases c WHERE c.version_id=v.id) + (SELECT count(*) FROM problem_odyssey_cases c WHERE c.version_id=v.id))::bigint AS cases FROM problem_versions v WHERE v.id=${id}::uuid FOR UPDATE`,
                )
              ).rows[0];
              // Refuse oversized legacy versions rather than exceeding the offline operator's memory budget.
              if (!size || Number(size.bytes) > 16 * 1024 * 1024 || Number(size.cases) > 10000)
                throw new Error("Problem fixture exceeds operator bounds");
              const row = (
                await tx.execute<{
                  raw: string;
                }>(sql`SELECT COALESCE(convert_from(v.lossless_fixture,'UTF8'),jsonb_build_object(
              'problem',jsonb_build_object('id',v.id,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,'sql',v.sql_config,'odyssey',v.odyssey,
              'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'calls',calls) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'::jsonb)),
              'hiddenCases',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'calls',calls) ORDER BY ordinal) FROM problem_test_cases WHERE version_id=v.id),'[]'::jsonb),
              'odysseyHiddenCases',CASE WHEN v.odyssey IS NULL THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(COALESCE((SELECT jsonb_agg(c.case_data ORDER BY c.ordinal) FROM problem_odyssey_cases c WHERE c.version_id=v.id AND c.level=stage.ordinality-1),'[]'::jsonb) ORDER BY stage.ordinality),'[]'::jsonb) FROM jsonb_array_elements(v.odyssey->'levels') WITH ORDINALITY stage(value,ordinality)) END)::text) AS raw FROM problem_versions v WHERE v.id=${id}::uuid AND v.sealed FOR UPDATE`)
              ).rows[0];
              if (!row) throw new Error("Problem version changed");
              await indexRunnerFixture(tx, { version: id }, row.raw);
              if (values["dry-run"]) throw new DryRun();
            }),
          );
        } catch (error) {
          if (!(error instanceof DryRun)) throw error;
        }
        completed++;
        after = id;
      }
    }
    if (!complete)
      complete = await run<boolean>((scope) =>
        scope.transaction(
          { readOnly: true, statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
          async (tx) =>
            !(
              await tx.execute(
                sql`SELECT 1 FROM problem_versions v WHERE v.sealed AND (${after}::uuid IS NULL OR v.id>${after}::uuid) AND NOT EXISTS (SELECT 1 FROM runner_version_inputs i WHERE i.version_id=v.id AND i.sealed) LIMIT 1`,
              )
            ).rows.length,
        ),
      );
    return { completed, complete, dryRun: values["dry-run"]! };
  } catch {
    throw new ProblemInputsIncomplete(completed, values["dry-run"]!);
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  try {
    const result = await backfillProblemInputs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.complete && !result.dryRun) process.exitCode = 2;
  } catch (error) {
    if (error instanceof ProblemInputsIncomplete)
      process.stdout.write(
        `${JSON.stringify({ completed: error.completed, complete: false, dryRun: error.dryRun })}\n`,
      );
    console.error("Problem input backfill failed");
    process.exitCode = 1;
  }
}
