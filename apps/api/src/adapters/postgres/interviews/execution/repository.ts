/** @file repository.ts @description Atomic interview execution admission. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { parseLosslessJson, JsonNumber, type JsonValue } from "@quorem/questions";
import { sourceHash } from "@quorem/execution";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { InterviewExecutionCommand } from "../../../../modules/interviews/execution/command.ts";
import type { AdmissionFence } from "../../../../modules/judging/admission/admit.ts";
import { selectExecutionCases } from "../../../../modules/judging/admission/select-cases.ts";
import { consumePrearm } from "../../events/scheduling/prearm.ts";
import { insertAdmittedExecution } from "../../judging/admission/core.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { lockInterview, readInterviewAccess } from "../lifecycle/access.ts";
import { priorOperationRecord, saveOperation } from "../lifecycle/operations.ts";
import { interviewExecutionFingerprint } from "./fingerprint.ts";
import { saveInterviewFixture } from "./fixture.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Obj = { [key: string]: JsonValue };
const obj = (v: JsonValue): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof JsonNumber)
    throw new Error("Invalid interview fixture");
  return v;
};
const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 | 503) =>
  new ApplicationError(code, message, status);
export function postgresInterviewAdmission(
  run: Run,
  config: { losslessCases: boolean; guestExecution: boolean },
) {
  return async (
    actor: Principal,
    id: string,
    key: string,
    command: InterviewExecutionCommand,
    fence: AdmissionFence,
  ) => {
    const hash = await interviewExecutionFingerprint(id, command);
    return run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, async (tx) => {
        await consumePrearm(tx, fence.receiptId, fence.shard, "execution");
        const user = (
          await tx.execute<{ kind: string }>(
            sql`SELECT kind FROM users WHERE id=${actor.userId} AND NOT disabled FOR NO KEY UPDATE`,
          )
        ).rows[0];
        if (!user || (user.kind === "guest") !== (actor.kind === "guest"))
          throw fail("not_found", "Interview unavailable", 404);
        if (actor.kind === "guest" && !config.guestExecution)
          throw fail("temporarily_unavailable", "Guest execution is temporarily paused", 503);
        await readInterviewAccess(tx, actor, id, capabilitiesInTransaction, { active: true });
        const prior = await priorOperationRecord(tx, actor.userId, key, hash);
        const room = await lockInterview(tx, actor, id, capabilitiesInTransaction, {
          active: true,
        });
        if (prior) {
          if (
            prior.id.toLowerCase() !== id.toLowerCase() ||
            !prior.response ||
            typeof prior.response !== "object" ||
            !("submissionId" in prior.response) ||
            typeof prior.response.submissionId !== "string"
          )
            throw new Error("Invalid stored interview operation");
          const found = (
            await tx.execute<{ id: string; state: string; sourceHash: string; admittedAt: string }>(
              sql`SELECT s.id::text,s.state,s.source_hash AS "sourceHash",to_char(s.admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "admittedAt" FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE s.id=${prior.response.submissionId}::uuid AND e.session_id=${id}::uuid AND s.owner_id=${actor.userId}`,
            )
          ).rows[0];
          if (!found) throw new Error("Missing interview operation result");
          return found;
        }
        const row = (
          await tx.execute<{
            source: string;
            documentVersion: string;
            documentEpoch: string;
            questionEpoch: string;
            language: string;
            fixture: string;
          }>(
            sql`SELECT source,document_version::text AS "documentVersion",document_epoch::text AS "documentEpoch",question_epoch::text AS "questionEpoch",language,convert_from(COALESCE(lossless_question,convert_to(question::text,'UTF8')),'UTF8') AS fixture FROM interviews WHERE id=${id}::uuid`,
          )
        ).rows[0];
        if (
          command.questionEpoch !== row.questionEpoch ||
          command.documentEpoch !== row.documentEpoch ||
          command.sourceHash !== (await sourceHash(row.source))
        )
          throw fail("document_changed", "Document changed; synchronize and retry", 409);
        const fixture = obj(parseLosslessJson(row.fixture)),
          problem = obj(fixture.problem),
          odyssey = problem.odyssey;
        let level = 1,
          scope: string | null = null;
        if (odyssey !== undefined && odyssey !== null) {
          if (typeof problem.id !== "string") throw new Error("Invalid problem identity");
          const problemId = problem.id;
          scope = row.questionEpoch;
          await tx.execute(
            sql`INSERT INTO odyssey_progress(scope_id,problem_version_id) VALUES(${scope}::uuid,${problemId}::uuid) ON CONFLICT DO NOTHING`,
          );
          level = Number(
            (
              await tx.execute<{ level: number }>(
                sql`SELECT level FROM odyssey_progress WHERE scope_id=${scope}::uuid AND problem_version_id=${problemId}::uuid FOR UPDATE`,
              )
            ).rows[0].level,
          );
        }
        if (level !== command.level)
          throw fail("stage_changed", "Stage changed; refresh before running", 409);
        const cases = selectExecutionCases(
          row.fixture,
          command.kind,
          level,
          command.customCases,
          true,
        );
        const revision = problem.runtimeRevision,
          harness = fixture.harnessRevision;
        if (typeof revision !== "string" || typeof harness !== "string")
          throw new Error("Missing runtime revision");
        const result = await insertAdmittedExecution(tx, {
          ownerId: actor.userId,
          jobId: fence.jobId,
          kind: command.kind,
          source: row.source,
          sourceHash: command.sourceHash,
          cases,
          customRun: command.customCases !== null,
          language: row.language,
          runtimeRevision: revision,
          harnessRevision: harness,
          sponsorId: actor.kind === "guest" ? room.host : null,
          context: { kind: "interview", interviewId: id },
          losslessCases: config.losslessCases,
        });
        const fixtureId = await saveInterviewFixture(tx, id, row.fixture);
        await tx.execute(
          sql`INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture_id,level,progress_scope,question_epoch) VALUES(${result.id}::uuid,${id}::uuid,${row.documentVersion}::bigint,${row.documentEpoch}::uuid,${fixtureId},${level},${scope}::uuid,${row.questionEpoch}::uuid)`,
        );
        await saveOperation(tx, actor.userId, key, hash, id, { submissionId: result.id });
        return {
          id: result.id,
          state: "queued",
          sourceHash: command.sourceHash,
          admittedAt: result.admittedAt,
        };
      }),
    );
  };
}
