/** @file repository.ts @description Authorized submission reads and atomic cancellation. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { SubmissionSnapshots } from "../../../../modules/judging/results/model.ts";
import { lookupGuestInTransaction } from "../../identity/guest.ts";
import { encode, object, publicResult } from "./projection.ts";
import { interviewAccess, interviewProjection } from "./interview.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Row = {
  id: string;
  workspace: string | null;
  kind: string;
  state: string;
  source_hash: string;
  admitted: string;
  updated: string;
  custom: boolean;
  interview: string | null;
  match: string | null;
  result: Uint8Array | null;
};
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Submission not found", 404);
async function identity(tx: Transaction, who: Principal): Promise<void> {
  const user = await tx.execute(
    sql`SELECT id FROM users WHERE id=${who.userId} AND NOT disabled FOR SHARE`,
  );
  if (!user.rows.length) throw missing();
  if (who.kind === "guest") {
    const actual = await lookupGuestInTransaction(tx, who.scope.kind, who.sessionId);
    if (
      !actual ||
      actual.userId !== who.userId ||
      actual.scope.kind !== who.scope.kind ||
      (actual.scope.kind === "match" ? actual.scope.matchId : actual.scope.interviewId) !==
        (who.scope.kind === "match" ? who.scope.matchId : who.scope.interviewId)
    )
      throw missing();
  }
}
async function load(tx: Transaction, id: string, owner?: string, lock = false): Promise<Row> {
  if (!uuid.test(id)) throw missing();
  const result = await tx.execute<Row>(
    sql`SELECT s.id::text,s.workspace_id::text AS workspace,s.kind,s.state,s.source_hash,to_char(s.admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted,to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated,s.custom_run AS custom,s.interview_id::text AS interview,s.match_id::text AS match,COALESCE(s.result_payload,convert_to(s.result::text,'UTF8')) AS result FROM submissions s WHERE s.id=${id}::uuid ${owner === undefined ? sql`` : sql`AND s.owner_id=${owner}`} ${lock ? sql`FOR UPDATE OF s` : sql``}`,
  );
  const row = result.rows[0];
  if (!row) throw missing();
  return row;
}
function assertScope(who: Principal, row: Row): void {
  if (who.kind !== "guest") return;
  if (
    who.scope.kind === "match"
      ? row.match !== who.scope.matchId
      : row.interview !== who.scope.interviewId
  )
    throw missing();
}
function snapshot(row: Row, hideInterview: boolean): { [key: string]: JsonValue } {
  return {
    id: row.id,
    ...(row.workspace ? { workspaceId: row.workspace } : {}),
    kind: row.kind,
    state: row.state,
    sourceHash: row.source_hash,
    admittedAt: row.admitted,
    updatedAt: row.updated,
    ...(row.custom ? { customRun: true } : {}),
    ...publicResult(row.result, hideInterview && row.interview !== null && row.kind === "submit"),
  };
}
export function submissionSnapshots(run: Run): SubmissionSnapshots {
  return {
    async read(who, id) {
      return run((scope) =>
        scope.transaction({ ...options, isolation: "repeatable read" }, async (tx) => {
          await identity(tx, who);
          const row = await load(tx, id, who.userId);
          assertScope(who, row);
          return encode(snapshot(row, true));
        }),
      );
    },
    async interview(who, interviewId, id) {
      if (!uuid.test(interviewId)) throw missing();
      return run((scope) =>
        scope.transaction({ ...options, isolation: "repeatable read" }, async (tx) => {
          await identity(tx, who);
          const access = await interviewAccess(tx, who, interviewId);
          const row = await load(tx, id);
          if (row.interview !== interviewId) throw missing();
          const value = snapshot(row, false);
          return encode(await interviewProjection(tx, access, interviewId, id, row.kind, value));
        }),
      );
    },
    async cancel(who, id, key) {
      if (!uuid.test(id)) throw missing();
      if (!key || new TextEncoder().encode(key).length > 128)
        throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          await identity(tx, who);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
          const replay = (
            await tx.execute<{ submission: string; response: string }>(
              sql`SELECT submission_id::text AS submission,response::text AS response FROM cancellation_idempotency WHERE owner_id=${who.userId} AND key=${key} AND expires_at>clock_timestamp()`,
            )
          ).rows[0];
          if (replay) {
            if (replay.submission !== id.toLowerCase())
              throw new ApplicationError(
                "idempotency_conflict",
                "Key was used for a different cancellation",
                409,
              );
            const row = await load(tx, id, who.userId);
            assertScope(who, row);
            return stringifyLosslessJson(object(parseLosslessJson(replay.response)));
          }
          const row = await load(tx, id, who.userId, true);
          assertScope(who, row);
          if (row.match && row.kind === "submit")
            throw new ApplicationError(
              "invalid_transition",
              "Match submissions cannot be cancelled",
              409,
            );
          if (row.state === "queued") {
            await tx.execute(
              sql`UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE submission_id=${id}::uuid`,
            );
            await tx.execute(
              sql`UPDATE submissions SET state='cancelled',cancel_requested=true,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
            );
          } else if (row.state === "running")
            await tx.execute(
              sql`UPDATE submissions SET cancel_requested=true,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
            );
          else if (row.state !== "cancelled")
            throw new ApplicationError("invalid_transition", "Execution already finished", 409);
          const response = encode(snapshot(await load(tx, id, who.userId), true));
          await tx.execute(
            sql`INSERT INTO cancellation_idempotency(owner_id,key,submission_id,response,expires_at) VALUES(${who.userId},${key},${id}::uuid,${response}::jsonb,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,key) DO UPDATE SET submission_id=EXCLUDED.submission_id,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`,
          );
          return response;
        }),
      );
    },
  };
}
