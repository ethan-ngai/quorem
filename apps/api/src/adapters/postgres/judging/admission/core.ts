import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { runtimeForRevision } from "@quorem/execution";
import { ApplicationError } from "../../../../application/error.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { insertExecutionIntent } from "../../events/dispatch.ts";
import { storeCases } from "./cases.ts";

export interface ExecutionAdmissionSnapshot {
  ownerId: string;
  jobId: string;
  kind: "run" | "submit";
  source: string;
  sourceHash: string;
  cases: string;
  customRun: boolean;
  language: string;
  runtimeRevision: string;
  harnessRevision: string;
  sponsorId: string | null;
  context:
    | {
        kind: "workspace";
        workspaceId: string;
        matchId: string | null;
        matchSequence: string | null;
        admittedAt: string | null;
        odysseyLevel: number | null;
      }
    | { kind: "interview"; interviewId: string };
  losslessCases: boolean;
}
/** Owner and room/document locks must already be held; all writes use the caller's transaction. */
export async function insertAdmittedExecution(
  tx: Transaction,
  snapshot: ExecutionAdmissionSnapshot,
): Promise<{ id: string; admittedAt: string }> {
  const s = snapshot,
    runtime = runtimeForRevision(s.runtimeRevision, s.harnessRevision);
  if (!runtime || runtime.language !== s.language)
    throw new ApplicationError("temporarily_unavailable", "Execution runtime unavailable", 503);
  const selected = storeCases(s.cases, s.losslessCases);
  const busy = (
    await tx.execute<{ busy: boolean; tokens: string; daily: number }>(
      sql`SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=${s.ownerId} AND state IN ('queued','running')) AS busy,LEAST(2,admission_tokens+EXTRACT(EPOCH FROM(clock_timestamp()-tokens_updated_at))/6.0)::text AS tokens,(SELECT count(*)::int FROM submissions WHERE owner_id=${s.ownerId} AND admitted_at>clock_timestamp()-interval '24 hours') AS daily FROM users WHERE id=${s.ownerId}`,
    )
  ).rows[0];
  if (!busy) throw new Error("Admission owner not locked");
  if (busy.busy) throw new ApplicationError("user_busy", "Another execution is active", 409);
  if (Number(busy.tokens) < 1 || busy.daily >= 100)
    throw new ApplicationError("quota_exceeded", "Execution quota reached", 429);
  if (s.sponsorId) {
    await tx.execute(
      sql`INSERT INTO guest_sponsor_locks(user_id) VALUES(${s.sponsorId}) ON CONFLICT DO NOTHING`,
    );
    await tx.execute(
      sql`SELECT user_id FROM guest_sponsor_locks WHERE user_id=${s.sponsorId} FOR UPDATE`,
    );
    const caps = await capabilitiesInTransaction(tx, s.sponsorId);
    const active = Number(
      (
        await tx.execute(
          sql`SELECT (SELECT count(*) FROM guest_execution_usage WHERE sponsor_id=${s.sponsorId} AND settled_at IS NULL)+(SELECT count(*) FROM interview_execution e JOIN interviews i ON i.id=e.session_id JOIN submissions s ON s.id=e.submission_id JOIN users u ON u.id=s.owner_id WHERE i.host_id=${s.sponsorId} AND u.kind='guest' AND s.state IN ('queued','running')) AS count`,
        )
      ).rows[0].count,
    );
    if (active >= caps.guestConcurrency)
      throw new ApplicationError(
        s.context.kind === "interview" ? "quota_exceeded" : "rate_limited",
        s.context.kind === "interview"
          ? "Host guest execution capacity reached"
          : "Another guest execution is active; try again shortly",
        429,
      );
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
  if (
    Number(
      (await tx.execute(sql`SELECT count(*)::int AS count FROM execution_jobs WHERE NOT finished`))
        .rows[0].count,
    ) >= 200
  )
    throw new ApplicationError("queue_saturated", "Judge queue is full", 429);
  const id = crypto.randomUUID(),
    workspace = s.context.kind === "workspace" ? s.context : null,
    interview = s.context.kind === "interview" ? s.context : null;
  const inserted = (
    await tx.execute<{ admittedAt: string }>(
      sql`INSERT INTO submissions(id,owner_id,workspace_id,interview_id,kind,source,source_hash,state,cases,match_id,match_sequence,admitted_at,odyssey_level,custom_run,lossless_cases) VALUES(${id}::uuid,${s.ownerId},${workspace?.workspaceId ?? null}::uuid,${interview?.interviewId ?? null}::uuid,${s.kind},${s.source},${s.sourceHash},'queued',${selected.json}::jsonb,${workspace?.matchId ?? null}::uuid,${workspace?.matchSequence ?? null}::bigint,COALESCE(${workspace?.admittedAt ?? null}::timestamptz,clock_timestamp()),${workspace?.odysseyLevel ?? null},${s.customRun},${selected.lossless}) RETURNING to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "admittedAt"`,
    )
  ).rows[0];
  await tx.execute(
    sql`INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES(${s.jobId}::uuid,${id}::uuid,${s.language},${s.runtimeRevision},${s.harnessRevision})`,
  );
  await insertExecutionIntent(tx, crypto.randomUUID(), s.jobId);
  if (s.sponsorId && workspace?.matchId)
    await tx.execute(
      sql`INSERT INTO guest_execution_usage(submission_id,match_id,sponsor_id) VALUES(${id}::uuid,${workspace.matchId}::uuid,${s.sponsorId})`,
    );
  await tx.execute(
    sql`UPDATE users SET admission_tokens=${busy.tokens}::numeric-1,tokens_updated_at=clock_timestamp() WHERE id=${s.ownerId}`,
  );
  return { id, admittedAt: inserted.admittedAt };
}
