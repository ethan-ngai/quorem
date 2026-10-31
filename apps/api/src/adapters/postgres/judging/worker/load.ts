import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import type { ExecutionSpec, Job } from "@quorem/execution";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Obj = { [key: string]: JsonValue };
function object(value: JsonValue | undefined): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid execution fixture");
  return value;
}
function list(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new Error("Invalid execution fixture");
  return value;
}
function text(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}
function sample(value: JsonValue): string {
  const item = object(value),
    out: Obj = { args: item.args ?? null };
  if (item.expected !== undefined) out.expected = item.expected;
  if (Array.isArray(item.calls) && item.calls.length) out.calls = item.calls;
  return stringifyLosslessJson(out);
}
/** Load only the fenced attempt; case and problem JSON retain all numeric lexemes. */
export function postgresExecutionLoad(run: Run, lossless: boolean) {
  return async (job: Job): Promise<ExecutionSpec> =>
    run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) => {
          const row = (
            await tx.execute<{
              source: string;
              kind: string;
              problem: string;
              cases: Uint8Array;
              fixture: Uint8Array | null;
              private: boolean;
              fallback: boolean;
              level: number | null;
              hasSidecar: boolean;
            }>(
              sql`SELECT s.source,s.kind,CASE WHEN ie.submission_id IS NULL THEN jsonb_build_object('signature',v.signature,'constraints',v.constraints,'limits',v.limits,'odyssey',v.odyssey,'sql',v.sql_config,'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation,'calls',calls) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'::jsonb)) ELSE q.fixture->'problem' END::text AS problem,COALESCE(s.lossless_cases,convert_to(s.cases::text,'UTF8')) AS cases,COALESCE(q.lossless_fixture,v.lossless_fixture) AS fixture,ie.submission_id IS NOT NULL AS private,(ie.submission_id IS NOT NULL AND s.kind='submit' AND COALESCE(jsonb_typeof(q.fixture->'problem'->'odyssey'),'null')='null' AND CASE COALESCE(jsonb_typeof(q.fixture->'hiddenCases'),'null') WHEN 'array' THEN jsonb_array_length(q.fixture->'hiddenCases') WHEN 'null' THEN 0 ELSE -1 END=0) AS fallback,COALESCE(s.odyssey_level,ie.level) AS level,(s.lossless_cases IS NOT NULL OR q.lossless_fixture IS NOT NULL OR v.lossless_fixture IS NOT NULL) AS "hasSidecar" FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE j.id=${job.jobId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND NOT j.finished AND s.id=${job.submissionId}::uuid`,
            )
          ).rows[0];
          if (!row || (row.hasSidecar && !lossless)) throw new Error("Execution lease unavailable");
          if (row.kind !== "run" && row.kind !== "submit")
            throw new Error("Invalid execution kind");
          const problem = object(parseLosslessJson(row.problem)),
            stored = list(parseLosslessJson(text(row.cases)));
          if (row.fixture?.length) {
            const source = object(object(parseLosslessJson(text(row.fixture))).problem);
            problem.examples = source.examples ?? [];
            if (problem.odyssey && source.odyssey) {
              const current = list(object(problem.odyssey).levels),
                original = list(object(source.odyssey).levels);
              for (let i = 0; i < Math.min(current.length, original.length); i++)
                object(current[i]).examples = object(original[i]).examples ?? [];
            }
          }
          let examples = list(problem.examples ?? []);
          if (problem.odyssey) {
            const odyssey = object(problem.odyssey),
              levels = list(odyssey.levels);
            if (
              row.level === null ||
              !Number.isInteger(row.level) ||
              row.level < 1 ||
              row.level > levels.length
            )
              throw new Error("Invalid admitted stage");
            odyssey.levels = levels.slice(0, row.level);
            examples = list(odyssey.levels).flatMap((level) => list(object(level).examples ?? []));
          }
          return {
            problemJson: stringifyLosslessJson(problem),
            source: row.source,
            kind: row.kind,
            cases: stored.map(stringifyLosslessJson),
            submitSamples: row.kind === "submit" ? examples.map(sample) : [],
            submitCasesAreSamples: row.fallback,
            privateDetails: row.private,
          };
        },
      ),
    );
}
