/** @file commands.ts @description Atomic interview question and stage commands. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError, type ApplicationStatus } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type {
  HintVisibility,
  InterviewQuestions,
} from "../../../../modules/interviews/question/model.ts";
import {
  interviewCommandFingerprint,
  interviewQuestionOperationFingerprint,
} from "../../../../modules/interviews/question/fingerprint.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { lockInterview } from "../lifecycle/access.ts";
import { operationFingerprint, priorOperation, saveOperation } from "../lifecycle/operations.ts";
import { object, storageProjection } from "../../problems/storage.ts";
import { validateInterviewQuestionShape } from "../../../../modules/interviews/question/validation.ts";
import { fingerprintQuestionInput } from "./fingerprint-input.ts";
import { preparePublishedInterviewQuestion } from "./prepare.ts";
import { savePublicExamples, savePrivateCases } from "./public-examples.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const fail = (code: string, message: string, status: ApplicationStatus = 400) =>
  new ApplicationError(code, message, status);
const arr = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const hintsValue = (v: unknown): HintVisibility => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !["topics", "complexity"].includes(k)) ||
    Object.values(v).some((x) => x !== null && typeof x !== "boolean")
  )
    throw fail("invalid_input", "Invalid hint visibility");
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) as HintVisibility;
};
const allowed = (h: HintVisibility) => ({
  topics: h.topics !== false,
  complexity: h.complexity === true,
});
function sameHints(a: HintVisibility, b: HintVisibility): boolean {
  const x = allowed(a),
    y = allowed(b);
  return x.topics === y.topics && x.complexity === y.complexity;
}
async function privateFixture(
  tx: Transaction,
  id: string,
): Promise<{ fixture: { [key: string]: JsonValue }; language: string; source: string }> {
  const row = (
    await tx.execute<{ raw: string; language: string; source: string }>(
      sql`SELECT convert_from(COALESCE(lossless_question,convert_to(question::text,'UTF8')),'UTF8') AS raw,language,source FROM interviews WHERE id=${id}::uuid`,
    )
  ).rows[0];
  if (!row) throw fail("not_found", "Interview unavailable", 404);
  return {
    fixture: object(parseLosslessJson(row.raw)),
    language: row.language,
    source: row.source,
  };
}
export function interviewQuestionCommands(run: Run): InterviewQuestions {
  const transact = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, fn));
  const mutate = async (
    actor: Principal,
    id: string,
    key: string,
    hash: string,
    manage: boolean,
    apply: (
      tx: Transaction,
      access: Awaited<ReturnType<typeof lockInterview>>,
    ) => Promise<void | false>,
  ) =>
    transact(async (tx) => {
      const prior = await priorOperation(tx, actor.userId, key, hash);
      const access = await lockInterview(tx, actor, id, capabilitiesInTransaction, { manage });
      if (prior) return JSON.stringify({ id });
      await lockInterview(tx, actor, id, capabilitiesInTransaction, { manage, active: true });
      await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
      const changed = await apply(tx, access);
      if (changed !== false)
        await tx.execute(
          sql`UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
        );
      await saveOperation(tx, actor.userId, key, hash, id);
      return JSON.stringify({ id });
    });
  return {
    async select(actor, id, key, question, rawBody) {
      validateInterviewQuestionShape(question);
      const identity = fingerprintQuestionInput(question, rawBody, false);
      const hash = await interviewQuestionOperationFingerprint(
        `${id}:question`,
        identity.question,
        identity.marks,
      );
      return mutate(actor, id, key, hash, true, async (tx, access) => {
        const row = (
          await tx.execute<{ hints: unknown }>(
            sql`SELECT question->'hints' AS hints FROM interviews WHERE id=${id}::uuid`,
          )
        ).rows[0];
        const priorHints =
          row?.hints && typeof row.hints === "object" ? hintsValue(row.hints) : undefined;
        const q = question as Record<string, unknown>;
        const requested = q?.hints == null ? priorHints : hintsValue(q.hints);
        if (actor.userId !== access.host && !sameHints(priorHints ?? {}, requested ?? {}))
          throw fail("forbidden", "Only the host can change question hints", 403);
        const prepared = await preparePublishedInterviewQuestion(tx, actor, {
          title: "",
          question,
        });
        if (prepared.persist) await prepared.persist(tx);
        const raw = prepared.lossless
          ? new TextDecoder("utf-8", { fatal: true }).decode(prepared.lossless)
          : prepared.safe;
        const fixture = object(parseLosslessJson(raw));
        if (requested === undefined) delete fixture.hints;
        else fixture.hints = requested as { [key: string]: JsonValue };
        const stored = storageProjection(stringifyLosslessJson(fixture)),
          epoch = crypto.randomUUID();
        await tx.execute(
          sql`UPDATE interviews SET question=${stored.safe}::jsonb,lossless_question=${stored.lossless},language=${prepared.language},source=${prepared.source},document_version=0,document_epoch=${crypto.randomUUID()}::uuid,question_epoch=${epoch}::uuid WHERE id=${id}::uuid`,
        );
        await savePublicExamples(tx, id, epoch, stringifyLosslessJson(fixture));
        await savePrivateCases(tx, id, epoch, stringifyLosslessJson(fixture));
      });
    },
    async hints(actor, id, key, hints) {
      const clean = hintsValue(hints),
        hash = await interviewCommandFingerprint(`${id}:hints`, clean);
      return mutate(actor, id, key, hash, true, async (tx, access) => {
        if (actor.userId !== access.host)
          throw fail("forbidden", "Only the host can change question hints", 403);
        const { fixture } = await privateFixture(tx, id);
        fixture.hints = clean as { [key: string]: JsonValue };
        const stored = storageProjection(stringifyLosslessJson(fixture));
        await tx.execute(
          sql`UPDATE interviews SET question=${stored.safe}::jsonb,lossless_question=${stored.lossless} WHERE id=${id}::uuid`,
        );
      });
    },
    async language(actor, id, key, language, epoch) {
      const hash = await operationFingerprint(`${id}:language`, [language, epoch]);
      return mutate(actor, id, key, hash, false, async (tx, access) => {
        if (epoch !== access.documentEpoch)
          throw fail("document_changed", "Document changed; synchronize and retry", 409);
        const prior = await privateFixture(tx, id),
          problem = object(prior.fixture.problem),
          implementation = arr(problem.languages)
            .map(object)
            .find((v) => v.language === language);
        if (
          !implementation ||
          typeof implementation.starterSource !== "string" ||
          typeof implementation.runtimeRevision !== "string" ||
          typeof implementation.harnessRevision !== "string"
        )
          throw fail("invalid_input", "Language unavailable for this question");
        if (language === prior.language) return false;
        await tx.execute(
          sql`INSERT INTO interview_language_drafts(session_id,question_epoch,language,source) VALUES(${id}::uuid,${access.questionEpoch}::uuid,${prior.language},${prior.source}) ON CONFLICT(session_id,question_epoch,language) DO UPDATE SET source=EXCLUDED.source`,
        );
        const saved = (
          await tx.execute<{ source: string }>(
            sql`DELETE FROM interview_language_drafts WHERE session_id=${id}::uuid AND question_epoch=${access.questionEpoch}::uuid AND language=${language} RETURNING source`,
          )
        ).rows[0];
        problem.starterSource = implementation.starterSource;
        problem.runtimeRevision = implementation.runtimeRevision;
        prior.fixture.harnessRevision = implementation.harnessRevision;
        const stored = storageProjection(stringifyLosslessJson(prior.fixture));
        await tx.execute(
          sql`UPDATE interviews SET language=${language},source=${saved?.source ?? implementation.starterSource},document_version=0,document_epoch=${crypto.randomUUID()}::uuid,question=${stored.safe}::jsonb,lossless_question=${stored.lossless} WHERE id=${id}::uuid`,
        );
      });
    },
    async passStage(actor, id, key, epoch, level) {
      if (!epoch || !Number.isSafeInteger(level) || level < 1)
        throw fail("invalid_input", "Question and stage required");
      const hash = await interviewCommandFingerprint(`${id}:pass-stage`, {
        Epoch: epoch,
        Level: level,
      });
      return mutate(actor, id, key, hash, true, async (tx, access) => {
        if (actor.userId !== access.host)
          throw fail("forbidden", "Only the host can pass a stage", 403);
        if (epoch !== access.questionEpoch)
          throw fail("document_changed", "Question changed; refresh before passing a stage", 409);
        const row = (
          await tx.execute<{ problemId: string; total: number; level: number; completed: boolean }>(
            sql`SELECT q.metadata->'problem'->>'id' AS "problemId",CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END AS total,COALESCE(p.level,1) AS level,COALESCE(p.completed,false) AS completed FROM interview_question_public q LEFT JOIN odyssey_progress p ON p.scope_id=q.question_epoch AND p.problem_version_id=NULLIF(q.metadata->'problem'->>'id','')::uuid WHERE q.session_id=${id}::uuid AND q.question_epoch=${epoch}::uuid`,
          )
        ).rows[0];
        if (!row || !row.total) throw fail("invalid_input", "Question has no stages");
        if (level !== row.level || row.completed)
          throw fail("stale_version", "Stage changed; refresh before passing a stage", 409);
        const result = await tx.execute(
          sql`INSERT INTO odyssey_progress(scope_id,problem_version_id,level,completed) VALUES(${epoch}::uuid,${row.problemId}::uuid,${Math.min(level + 1, row.total)},${level === row.total}) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=EXCLUDED.level,completed=EXCLUDED.completed WHERE odyssey_progress.level=${level} AND NOT odyssey_progress.completed RETURNING level`,
        );
        if (!result.rows.length)
          throw fail("stale_version", "Stage changed; refresh before passing a stage", 409);
      });
    },
    async caseVisibility(actor, id, key, caseId, revealed, epoch) {
      if (!epoch || typeof revealed !== "boolean")
        throw fail("invalid_input", "Test visibility required");
      const hash = await interviewCommandFingerprint(`${id}:case-visibility`, {
        ID: caseId,
        Revealed: revealed,
        Epoch: [epoch],
      });
      return mutate(actor, id, key, hash, true, async (tx, access) => {
        if (epoch !== access.questionEpoch)
          throw fail("document_changed", "Question changed; refresh test cases", 409);
        const found = (
          await tx.execute(
            sql`SELECT 1 FROM interview_question_private_cases WHERE session_id=${id}::uuid AND question_epoch=${epoch}::uuid AND case_id=${caseId}`,
          )
        ).rows;
        if (!found.length) throw fail("not_found", "Test case unavailable", 404);
        if (revealed)
          await tx.execute(
            sql`INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES(${id}::uuid,${epoch}::uuid,${caseId}) ON CONFLICT DO NOTHING`,
          );
        else
          await tx.execute(
            sql`DELETE FROM interview_case_visibility WHERE session_id=${id}::uuid AND question_epoch=${epoch}::uuid AND case_id=${caseId}`,
          );
      });
    },
  };
}
