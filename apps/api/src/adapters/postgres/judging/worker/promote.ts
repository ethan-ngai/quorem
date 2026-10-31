/** @file promote.ts @description Atomically publish a fenced completed result stream. @module judging */
import { writeVerifiedPrivateStatuses } from "../../interviews/question/private-status-write.ts";
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import {
  assertAttemptFence,
  type AttemptFence,
  type CompletionHeader,
  type Job,
} from "@quorem/execution";
import { savePrivateResultFrame } from "../../interviews/question/private-frame.ts";
import { reconcileMatch } from "../../matches/reconcile/repository.ts";
import { advanceOdyssey } from "./complete.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
/** Caller must have actually awaited teardown of this exact scope and attempt. */
export function postgresCompletionPromotion(run: Run) {
  return async (job: Job, proof: AttemptFence): Promise<void> => {
    assertAttemptFence(job, proof);
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        const initial = (
          await tx.execute<{ match: string | null }>(
            sql`SELECT s.match_id::text AS match FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
          )
        ).rows[0];
        if (!initial) throw new Error("Unknown completion");
        if (initial.match)
          await tx.execute(sql`SELECT id FROM matches WHERE id=${initial.match}::uuid FOR UPDATE`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
        await tx.execute(
          sql`SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid FOR UPDATE OF j,s`,
        );
        const receipt = await tx.execute(
          sql`SELECT 1 FROM execution_completion_receipts WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope}`,
        );
        if (receipt.rows.length) return;
        const staged = (
          await tx.execute<{ header: Uint8Array; eof: boolean }>(
            sql`SELECT header_data AS header,eof FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} FOR UPDATE`,
          )
        ).rows[0];
        if (!staged) throw new Error("Missing completion stream");
        const state = (
          await tx.execute<{
            live: boolean;
            cancelled: boolean;
            kind: string;
            cases: number;
            interview: boolean;
            attempts: number;
            samples: number;
            fallback: boolean;
          }>(
            sql`SELECT NOT j.finished AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND s.state='running' AS live,s.cancel_requested AS cancelled,s.kind,i.case_count AS cases,i.sample_count AS samples,i.submit_cases_are_samples AS fallback,s.interview_id IS NOT NULL AS interview,j.attempts FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN runner_job_inputs i ON i.job_id=j.id AND i.sealed WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
          )
        ).rows[0];
        if (!state?.live || !staged.eof) throw new Error("Stale or incomplete completion");
        const header = JSON.parse(decoder.decode(staged.header)) as CompletionHeader;
        if (initial.match) await reconcileMatch(tx, initial.match);
        if (!state.cancelled && header.engineFailure && state.attempts < 3) {
          await tx.execute(
            sql`UPDATE execution_jobs SET attempt_id=NULL,lease_until=NULL,available_at=clock_timestamp()+interval '1 second' WHERE id=${job.jobId}::uuid`,
          );
          await tx.execute(
            sql`UPDATE submissions SET state='queued',updated_at=clock_timestamp() WHERE id=${job.submissionId}::uuid`,
          );
          await tx.execute(
            sql`INSERT INTO execution_completion_receipts(job_id,attempt_id,sandbox_scope,outcome) VALUES(${job.jobId}::uuid,${job.attemptId}::uuid,${job.sandboxScope},'requeued')`,
          );
          await tx.execute(
            sql`DELETE FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid`,
          );
          return;
        }
        const terminal = state.cancelled
          ? "cancelled"
          : header.engineFailure
            ? "failed"
            : "completed";
        const channel = state.kind === "submit" ? "sample" : "public";
        const count =
          state.fallback && state.kind === "submit"
            ? state.cases
            : channel === "sample"
              ? header.sampleCount
              : header.publicCount;
        const present =
          state.fallback && state.kind === "submit"
            ? state.cases > 0
            : channel === "sample"
              ? header.samplePresent
              : header.publicPresent;
        let verdict: string | undefined;
        let passed = 0;
        if (terminal === "completed") {
          const sampleCount = state.fallback ? 0 : state.samples;
          if (
            (state.kind === "run" &&
              (header.publicCount !== state.cases || header.privateCount || header.sampleCount)) ||
            (state.kind === "submit" &&
              (header.publicCount ||
                header.privateCount !== state.cases ||
                header.sampleCount !== sampleCount)) ||
            (state.kind !== "run" && state.kind !== "submit") ||
            (state.kind === "submit" && state.cases < 1)
          )
            throw new Error("Invalid completion channels");
          const coverage = (
            await tx.execute<{
              total: number;
              verified: number;
              matched: number;
              passed: number;
              unresolved: number;
              failure: string | null;
            }>(sql`
            SELECT count(c.ordinal)::int AS total,count(v.ordinal)::int AS verified,
              count(v.ordinal) FILTER (WHERE f.status=v.status)::int AS matched,
              count(v.ordinal) FILTER (WHERE c.ordinal<i.case_count AND v.status='accepted')::int AS passed,
              count(v.ordinal) FILTER (WHERE c.ordinal<i.case_count AND v.status='executed')::int AS unresolved,
              (SELECT x.status FROM execution_verified_cases x WHERE x.job_id=i.job_id AND x.attempt_id=${job.attemptId}::uuid AND x.sandbox_scope=${job.sandboxScope} AND x.ordinal<i.case_count AND x.status NOT IN ('accepted','executed') ORDER BY x.ordinal LIMIT 1) AS failure
            FROM runner_job_inputs i JOIN runner_job_input_cases c ON c.job_id=i.job_id
            LEFT JOIN execution_verified_cases v ON v.job_id=c.job_id AND v.ordinal=c.ordinal AND v.attempt_id=${job.attemptId}::uuid AND v.sandbox_scope=${job.sandboxScope}
            LEFT JOIN execution_completion_frames f ON f.job_id=c.job_id AND f.channel=CASE WHEN c.ordinal>=i.case_count THEN 'sample' WHEN ${state.kind}='run' THEN 'public' ELSE 'private' END AND f.ordinal=CASE WHEN c.ordinal>=i.case_count THEN c.ordinal-i.case_count ELSE c.ordinal END
            WHERE i.job_id=${job.jobId}::uuid AND i.sealed GROUP BY i.job_id,i.case_count`)
          ).rows[0];
          const total = state.cases + sampleCount;
          if (
            !coverage ||
            coverage.total !== total ||
            coverage.verified !== total ||
            coverage.matched !== total
          )
            throw new Error("Manifest result verification unavailable");
          if (state.kind === "submit" && coverage.unresolved)
            throw new Error("Unresolved private result");
          passed = coverage.passed;
          verdict = coverage.failure ?? (coverage.unresolved ? undefined : "accepted");
          await tx.execute(
            sql`INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) SELECT ${job.submissionId}::uuid,${channel},ordinal,frame_data FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${state.fallback && state.kind === "submit" ? "private" : channel}`,
          );
          await tx.execute(
            sql`INSERT INTO submission_public_case_statuses(submission_id,channel,ordinal,case_index,status_json,status_hash) SELECT ${job.submissionId}::uuid,${channel},ordinal,ordinal,convert_to(to_json(status)::text,'UTF8'),sha256(convert_to(to_json(status)::text,'UTF8')) FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${state.fallback && state.kind === "submit" ? "private" : channel}`,
          );
          if (state.interview) {
            for (let ordinal = 0; ordinal < state.cases; ordinal++)
              await savePrivateResultFrame(
                tx,
                job.submissionId,
                job.jobId,
                job.attemptId,
                job.sandboxScope,
                ordinal,
              );
            await tx.execute(
              sql`UPDATE interview_execution SET private_results=COALESCE((SELECT jsonb_agg(jsonb_build_object('index',ordinal,'status',status) ORDER BY ordinal) FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel='private'),'[]'::jsonb),private_results_payload=NULL WHERE submission_id=${job.submissionId}::uuid`,
            );
          }
          if (state.kind === "submit" && verdict === "accepted")
            await advanceOdyssey(tx, job.submissionId);
        }
        const score =
          terminal === "completed" && state.kind === "submit"
            ? { passed, total: state.cases }
            : undefined;
        const resultHeader =
          terminal === "failed"
            ? {
                infrastructureError: "Judge unavailable",
                publicCasesPresent: false,
                publicCaseCount: 0,
                channel,
              }
            : terminal === "cancelled"
              ? { publicCasesPresent: false, publicCaseCount: 0, channel }
              : {
                  verdict,
                  score,
                  hiddenCasesPresent: state.kind === "submit",
                  hiddenCaseCount: state.kind === "submit" ? state.cases : undefined,
                  diagnosticsPresent: state.kind === "run" && header.diagnosticsPresent,
                  publicCasesPresent: present,
                  publicCaseCount: count,
                  channel,
                };
        const safe =
          terminal === "failed"
            ? { infrastructureError: "Judge unavailable" }
            : terminal === "cancelled"
              ? {}
              : { verdict, score };
        await tx.execute(sql`SELECT set_config('quorem.lossless_result_write','v1',true)`);
        await tx.execute(
          sql`INSERT INTO submission_result_headers(submission_id,header_data) VALUES(${job.submissionId}::uuid,${encoder.encode(JSON.stringify(resultHeader))})`,
        );
        if (terminal === "completed" && state.interview && state.kind === "submit")
          await writeVerifiedPrivateStatuses(
            tx,
            job.submissionId,
            job.jobId,
            state.cases,
            state.fallback,
          );
        if (terminal === "completed" && state.kind === "run" && header.diagnosticsPresent)
          await tx.execute(
            sql`INSERT INTO submission_result_header_fields(submission_id,field,field_data) SELECT ${job.submissionId}::uuid,field,field_data FROM execution_completion_header_fields WHERE job_id=${job.jobId}::uuid AND field='diagnostics'`,
          );
        if (terminal === "completed" && state.kind === "submit")
          await tx.execute(
            sql`INSERT INTO submission_result_header_fields(submission_id,field,field_data) SELECT ${job.submissionId}::uuid,'hiddenCases',convert_to('['||COALESCE(string_agg(json_build_object('index',ordinal,'status',CASE WHEN status='accepted' THEN 'accepted' WHEN status='time_limit' THEN 'time_limit' ELSE 'wrong_answer' END)::text,',' ORDER BY ordinal),'')||']','UTF8') FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel='private'`,
          );
        if (
          !(
            await tx.execute<{ live: boolean }>(
              sql`SELECT lease_until>clock_timestamp() AS live FROM execution_jobs WHERE id=${job.jobId}::uuid`,
            )
          ).rows[0]?.live
        )
          throw new Error("Stale completion");
        await tx.execute(
          sql`UPDATE submissions SET state=${terminal},result=${JSON.stringify(safe)}::jsonb,result_payload=NULL,updated_at=clock_timestamp() WHERE id=${job.submissionId}::uuid`,
        );
        await tx.execute(
          sql`INSERT INTO execution_completion_receipts(job_id,attempt_id,sandbox_scope,outcome) VALUES(${job.jobId}::uuid,${job.attemptId}::uuid,${job.sandboxScope},${terminal})`,
        );
        await tx.execute(
          sql`DELETE FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid`,
        );
        await tx.execute(
          sql`UPDATE execution_jobs SET finished=true,lease_until=NULL WHERE id=${job.jobId}::uuid`,
        );
        if (initial.match) await reconcileMatch(tx, initial.match);
      }),
    );
  };
}
