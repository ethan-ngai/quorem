import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { WorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import type { AdmissionFence } from "../../../../modules/judging/admission/admit.ts";
import { selectExecutionCases } from "../../../../modules/judging/admission/select-cases.ts";
import { reconcileMatch } from "../../matches/reconcile/repository.ts";
import { lookupGuestInTransaction } from "../../identity/guest.ts";
import { visibleProblem } from "../../problems/queries/public-projection.ts";
import { consumePrearm } from "../../events/scheduling/prearm.ts";
import { insertAdmittedExecution } from "./core.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export interface AdmissionResult {
  id: string;
  state: string;
  sourceHash: string;
  admittedAt: string;
}
export interface AdmissionOptions {
  losslessCases: boolean;
  guestExecution: boolean;
}
const failure = (code: string, message: string, status: 400 | 403 | 404 | 409 | 429 | 503) =>
  new ApplicationError(code, message, status);
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 2000 };
export function postgresWorkspaceAdmission(run: Run, config: AdmissionOptions) {
  return async (
    principal: Principal,
    key: string,
    command: WorkspaceCommand,
    fence: AdmissionFence,
  ): Promise<AdmissionResult> =>
    run((scope) =>
      scope.transaction(options, async (tx) => {
        await consumePrearm(tx, fence.receiptId, fence.shard, "execution");
        const user = (
          await tx.execute<{ kind: string }>(
            sql`SELECT kind FROM users WHERE id=${principal.userId} AND NOT disabled FOR NO KEY UPDATE`,
          )
        ).rows[0];
        if (!user) throw failure("not_found", "Workspace not found", 404);
        if ((user.kind === "guest") !== (principal.kind === "guest"))
          throw failure("forbidden", "Guest membership unavailable", 403);
        const prior = (
          await tx.execute<{
            hash: string;
            id: string;
            state: string;
            sourceHash: string;
            admittedAt: string;
          }>(
            sql`SELECT i.body_hash AS hash,s.id::text,s.state,s.source_hash AS "sourceHash",to_char(s.admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "admittedAt" FROM execution_idempotency i JOIN submissions s ON s.id=i.submission_id WHERE i.owner_id=${principal.userId} AND i.key=${key} AND i.expires_at>clock_timestamp()`,
          )
        ).rows[0];
        if (prior) {
          if (prior.hash !== command.fingerprint)
            throw failure("idempotency_conflict", "Key was used for a different command", 409);
          return {
            id: prior.id,
            state: prior.state,
            sourceHash: prior.sourceHash,
            admittedAt: prior.admittedAt,
          };
        }
        const row = (
          await tx.execute<{
            version: string;
            matchId: string | null;
            language: string;
            revision: string;
            harness: string;
            fixture: string;
            lossless: Uint8Array | null;
          }>(
            sql`SELECT v.id::text AS version,w.match_id::text AS "matchId",w.language,l.runtime_revision AS revision,l.harness_revision AS harness,v.lossless_fixture AS lossless,jsonb_build_object('problem',jsonb_build_object('id',v.id,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,'sql',v.sql_config,'odyssey',v.odyssey,'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation,'calls',calls) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'::jsonb)),'hiddenCases',CASE WHEN ${command.kind}='submit' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'calls',calls) ORDER BY ordinal) FROM problem_test_cases WHERE version_id=v.id),'[]'::jsonb) ELSE '[]'::jsonb END,'odysseyHiddenCases',CASE WHEN v.odyssey IS NULL OR ${command.kind}<>'submit' THEN NULL ELSE (SELECT COALESCE(jsonb_agg(COALESCE((SELECT jsonb_agg(c.case_data ORDER BY c.ordinal) FROM problem_odyssey_cases c WHERE c.version_id=v.id AND c.level=stage.ordinality-1),'[]'::jsonb) ORDER BY stage.ordinality),'[]'::jsonb) FROM jsonb_array_elements(v.odyssey->'levels') WITH ORDINALITY stage(value,ordinality)) END)::text AS fixture FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id JOIN problems p ON p.id=v.problem_id JOIN problem_languages l ON l.version_id=v.id AND l.language=w.language WHERE w.id=${command.workspaceId}::uuid AND w.owner_id=${principal.userId} AND ((w.match_id IS NULL AND ${visibleProblem({ userId: principal.userId }, false)}) OR (w.match_id IS NOT NULL AND ${visibleProblem({ userId: principal.userId }, true)})) FOR SHARE OF w,p`,
          )
        ).rows[0];
        if (!row) throw failure("not_found", "Workspace not found", 404);
        let matchSequence: string | null = null,
          admissionTime: string | null = null,
          sponsor: string | null = null;
        if (row.matchId) {
          const locked = await tx.execute(
            sql`SELECT id FROM matches WHERE id=${row.matchId}::uuid FOR UPDATE`,
          );
          if (!locked.rows.length) throw failure("not_found", "Workspace not found", 404);
          const match = (
            await tx.execute<{ host: string; active: boolean; admittedAt: string }>(
              sql`SELECT m.host_owner_id AS host,m.state='active' AND m.deadline>clock_timestamp() AND m.problem_version_id=${row.version}::uuid AND NOT h.disabled AS active,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "admittedAt" FROM matches m JOIN users h ON h.id=m.host_owner_id WHERE m.id=${row.matchId}::uuid`,
            )
          ).rows[0];
          if (!match?.active) throw failure("invalid_transition", "Match admission is closed", 409);
          const member = await tx.execute(
            sql`SELECT 1 FROM match_participants WHERE match_id=${row.matchId}::uuid AND owner_id=${principal.userId} AND NOT forfeited`,
          );
          if (!member.rows.length)
            throw failure("invalid_transition", "Match participant is forfeited", 409);
          admissionTime = match.admittedAt;
          if (command.kind === "submit") {
            matchSequence = String(
              (
                await tx.execute(
                  sql`UPDATE matches SET admission_sequence=admission_sequence+1 WHERE id=${row.matchId}::uuid RETURNING admission_sequence::text AS sequence`,
                )
              ).rows[0].sequence,
            );
          }
          if (principal.kind === "guest") {
            if (!config.guestExecution)
              throw failure(
                "temporarily_unavailable",
                "Guest execution is temporarily paused",
                503,
              );
            if (principal.scope.kind !== "match" || principal.scope.matchId !== row.matchId)
              throw failure("forbidden", "Guest membership unavailable", 403);
            const current = await lookupGuestInTransaction(tx, "match", principal.sessionId);
            if (
              !current ||
              current.userId !== principal.userId ||
              current.scope.kind !== "match" ||
              current.scope.matchId !== row.matchId
            )
              throw failure("forbidden", "Guest membership unavailable", 403);
            sponsor = match.host;
          }
        } else if (principal.kind === "guest")
          throw failure("forbidden", "Guests can execute only in their match", 403);
        if (row.lossless?.length && !config.losslessCases)
          throw failure("temporarily_unavailable", "Execution fixture unavailable", 503);
        const fixture = row.lossless?.length
          ? new TextDecoder("utf-8", { fatal: true }).decode(row.lossless)
          : row.fixture;
        const odyssey = (
          await tx.execute<{ odyssey: boolean }>(
            sql`SELECT odyssey IS NOT NULL AS odyssey FROM problem_versions WHERE id=${row.version}::uuid`,
          )
        ).rows[0].odyssey;
        let level: number | null = null;
        if (odyssey) {
          await tx.execute(
            sql`INSERT INTO odyssey_progress(scope_id,problem_version_id) VALUES(${command.workspaceId}::uuid,${row.version}::uuid) ON CONFLICT DO NOTHING`,
          );
          level = Number(
            (
              await tx.execute(
                sql`SELECT level FROM odyssey_progress WHERE scope_id=${command.workspaceId}::uuid AND problem_version_id=${row.version}::uuid FOR UPDATE`,
              )
            ).rows[0].level,
          );
          if (command.level !== level)
            throw failure("revision_conflict", "Odyssey level changed; reload progress", 409);
        }
        const inserted = await insertAdmittedExecution(tx, {
          ownerId: principal.userId,
          jobId: fence.jobId,
          kind: command.kind,
          source: command.source,
          sourceHash: command.sourceHash,
          cases: selectExecutionCases(fixture, command.kind, level ?? 0, command.customCases),
          customRun: command.customCases !== null,
          language: row.language,
          runtimeRevision: row.revision,
          harnessRevision: row.harness,
          sponsorId: sponsor,
          losslessCases: config.losslessCases,
          context: {
            kind: "workspace",
            workspaceId: command.workspaceId,
            matchId: row.matchId,
            matchSequence,
            admittedAt: admissionTime,
            odysseyLevel: level,
          },
        });
        const id = inserted.id;
        await tx.execute(
          sql`INSERT INTO execution_idempotency(owner_id,key,body_hash,submission_id,expires_at) VALUES(${principal.userId},${key},${command.fingerprint},${id}::uuid,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,key) DO UPDATE SET body_hash=EXCLUDED.body_hash,submission_id=EXCLUDED.submission_id,expires_at=EXCLUDED.expires_at`,
        );
        if (row.matchId && command.kind === "submit") await reconcileMatch(tx, row.matchId);
        return {
          id,
          state: "queued",
          sourceHash: command.sourceHash,
          admittedAt: inserted.admittedAt,
        };
      }),
    );
}
