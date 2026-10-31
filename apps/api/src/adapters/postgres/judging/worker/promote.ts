/** @file promote.ts @description Atomically publish a fenced completed result stream. @module judging */
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
import { advanceOdyssey, validateSubmit } from "./complete.ts";

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
          await tx.execute<{ header: Uint8Array; eof: boolean; promoted: boolean }>(
            sql`SELECT header_data AS header,eof,promoted FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} FOR UPDATE`,
          )
        ).rows[0];
        if (!staged) throw new Error("Missing completion stream");
        if (staged.promoted) return;
        const state = (
          await tx.execute<{
            live: boolean;
            cancelled: boolean;
            kind: string;
            cases: number;
            interview: boolean;
            attempts: number;
          }>(
            sql`SELECT NOT j.finished AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND s.state='running' AS live,s.cancel_requested AS cancelled,s.kind,jsonb_array_length(s.cases)::int AS cases,s.interview_id IS NOT NULL AS interview,j.attempts FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
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
        if (terminal === "completed" && state.kind === "submit") {
          validateSubmit({ ...header, engineFailure: undefined }, state.cases);
          if (
            header.publicPresent ||
            (header.privatePresent && !state.interview) ||
            (header.privateCount && (!state.interview || header.privateCount !== state.cases))
          )
            throw new Error("Invalid completion channels");
          if (header.sampleCount) {
            const samples = (
              await tx.execute<{ count: number }>(
                sql`SELECT CASE WHEN COALESCE(q.fixture->'problem'->'odyssey',v.odyssey) IS NULL THEN COALESCE(jsonb_array_length(q.fixture->'problem'->'examples'),(SELECT count(*)::int FROM problem_examples WHERE version_id=v.id)) ELSE COALESCE((SELECT sum(jsonb_array_length(level->'examples')) FROM jsonb_array_elements(COALESCE(q.fixture->'problem'->'odyssey',v.odyssey)->'levels') WITH ORDINALITY st(level,n) WHERE n<=COALESCE(ie.level,s.odyssey_level)),0) END::int AS count FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=${job.submissionId}::uuid`,
              )
            ).rows[0]?.count;
            if (samples !== header.sampleCount) throw new Error("Incomplete sample results");
          }
        }
        if (
          terminal === "completed" &&
          state.kind === "run" &&
          (header.samplePresent || header.privatePresent)
        )
          throw new Error("Invalid completion channels");
        const channel = state.kind === "submit" ? "sample" : "public";
        const count = channel === "sample" ? header.sampleCount : header.publicCount;
        const present = channel === "sample" ? header.samplePresent : header.publicPresent;
        const summary: { index: number; status: string }[] = [];
        if (terminal === "completed") {
          for (let ordinal = 0; ordinal < count; ordinal++) {
            const row = (
              await tx.execute<{ status: string }>(
                sql`SELECT status FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${channel} AND ordinal=${ordinal}`,
              )
            ).rows[0];
            if (!row) throw new Error("Incomplete completion");
            summary.push({ index: ordinal, status: row.status });
          }
          await tx.execute(
            sql`INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) SELECT ${job.submissionId}::uuid,channel,ordinal,frame_data FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${channel}`,
          );
          const privateSummary: { index: number; status: string }[] = [];
          for (let i = 0; i < header.privateCount; i++) {
            const row = (
              await tx.execute<{ status: string }>(
                sql`SELECT status FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel='private' AND ordinal=${i}`,
              )
            ).rows[0];
            if (!row) throw new Error("Incomplete private results");
            privateSummary.push({ index: i, status: row.status });
            await savePrivateResultFrame(
              tx,
              job.submissionId,
              job.jobId,
              job.attemptId,
              job.sandboxScope,
              i,
            );
          }
          if (header.privatePresent)
            await tx.execute(
              sql`UPDATE interview_execution SET private_results=${JSON.stringify(privateSummary)}::jsonb,private_results_payload=NULL WHERE submission_id=${job.submissionId}::uuid`,
            );
          if (state.kind === "submit" && header.verdict === "accepted")
            await advanceOdyssey(tx, job.submissionId);
        }
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
                  verdict: header.verdict,
                  score: state.kind === "submit" ? header.score : undefined,
                  hiddenCases: state.kind === "submit" ? header.hiddenCases : undefined,
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
              : {
                  verdict: header.verdict,
                  score: state.kind === "submit" ? header.score : undefined,
                  hiddenCases: state.kind === "submit" ? header.hiddenCases : undefined,
                  publicCases: present ? summary : undefined,
                };
        await tx.execute(sql`SELECT set_config('quorem.lossless_result_write','v1',true)`);
        await tx.execute(
          sql`INSERT INTO submission_result_headers(submission_id,header_data) VALUES(${job.submissionId}::uuid,${encoder.encode(JSON.stringify(resultHeader))})`,
        );
        if (terminal === "completed" && state.kind === "run" && header.diagnosticsPresent)
          await tx.execute(
            sql`INSERT INTO submission_result_header_fields(submission_id,field,field_data) SELECT ${job.submissionId}::uuid,field,field_data FROM execution_completion_header_fields WHERE job_id=${job.jobId}::uuid AND field='diagnostics'`,
          );
        await tx.execute(
          sql`UPDATE submissions SET state=${terminal},result=${JSON.stringify(safe)}::jsonb,result_payload=NULL,updated_at=clock_timestamp() WHERE id=${job.submissionId}::uuid`,
        );
        await tx.execute(
          sql`UPDATE execution_completion_staging SET promoted=true WHERE job_id=${job.jobId}::uuid`,
        );
        await tx.execute(
          sql`INSERT INTO execution_completion_receipts(job_id,attempt_id,sandbox_scope,outcome) VALUES(${job.jobId}::uuid,${job.attemptId}::uuid,${job.sandboxScope},${terminal})`,
        );
        await tx.execute(
          sql`DELETE FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM execution_completion_header_fields WHERE job_id=${job.jobId}::uuid`,
        );
        await tx.execute(
          sql`UPDATE execution_jobs SET finished=true,lease_until=NULL WHERE id=${job.jobId}::uuid`,
        );
        if (initial.match) await reconcileMatch(tx, initial.match);
      }),
    );
  };
}
