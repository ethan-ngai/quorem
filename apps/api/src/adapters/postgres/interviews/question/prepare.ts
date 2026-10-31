/** @file prepare.ts @description Canonical published interview question construction. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { InterviewCreate } from "../../../../modules/interviews/lifecycle/model.ts";
import type { PreparedQuestion } from "../lifecycle/repository.ts";
import {
  interviewCreateFingerprint,
  losslessObject,
} from "../../../../modules/interviews/question/fingerprint.ts";
import { validateInterviewQuestionShape } from "../../../../modules/interviews/question/validation.ts";
import { fingerprintQuestionInput } from "./fingerprint-input.ts";
import { prepareCustomInterviewQuestion } from "./custom.ts";
import { object, storageProjection } from "../../problems/storage.ts";
const fail = (message: string) => new ApplicationError("invalid_input", message, 400);
/** Resolve an authorized published fixture inside the host's creation transaction. */
export async function preparePublishedInterviewQuestion(
  tx: Transaction,
  actor: Principal,
  command: InterviewCreate,
): Promise<PreparedQuestion> {
  validateInterviewQuestionShape(command.question);
  const q = command.question as Record<string, unknown>;
  if (command.monitoring !== undefined && command.monitoring !== null) {
    if (
      typeof command.monitoring !== "object" ||
      Array.isArray(command.monitoring) ||
      Object.keys(command.monitoring).some((k) => !["paste", "focus"].includes(k)) ||
      Object.values(command.monitoring).some((v) => v !== null && typeof v !== "boolean")
    )
      throw fail("Invalid monitoring");
  }
  const custom = q.custom !== undefined && q.custom !== null;
  const published = typeof q.problemVersionId === "string" && q.problemVersionId !== "";
  if (custom === published || typeof q.language !== "string")
    throw fail("Choose an existing question or custom question");
  const identity = fingerprintQuestionInput(command.question, command.rawBody, true);
  const fingerprint = await interviewCreateFingerprint(
    command.title,
    identity.question,
    command.monitoring,
    identity.marks,
  );
  if (custom) {
    let value;
    try {
      value = losslessObject(q.custom);
    } catch {
      throw fail("Invalid custom question");
    }
    const prepared = await prepareCustomInterviewQuestion(
      tx,
      actor,
      value,
      q.language,
      fingerprint,
    );
    if (q.hints !== undefined && q.hints !== null) {
      if (
        typeof q.hints !== "object" ||
        Array.isArray(q.hints) ||
        Object.keys(q.hints).some((k) => !["topics", "complexity"].includes(k)) ||
        Object.values(q.hints).some((v) => v !== null && typeof v !== "boolean")
      )
        throw fail("Invalid hint visibility");
      const raw = prepared.lossless
        ? new TextDecoder("utf-8", { fatal: true }).decode(prepared.lossless)
        : prepared.safe;
      const fixture = object(parseLosslessJson(raw));
      fixture.hints = Object.fromEntries(Object.entries(q.hints).filter(([, v]) => v !== null)) as {
        [key: string]: JsonValue;
      };
      const stored = storageProjection(stringifyLosslessJson(fixture));
      prepared.safe = stored.safe;
      prepared.lossless = stored.lossless;
    }
    return prepared;
  }
  const found = (
    await tx.execute<{ indexed: boolean }>(
      sql`SELECT COALESCE(r.sealed,false) AS indexed FROM problem_versions v JOIN problems p ON p.id=v.problem_id LEFT JOIN runner_version_inputs r ON r.version_id=v.id JOIN problem_languages l ON l.version_id=v.id AND l.language=${q.language} AND l.starter_source<>'' WHERE v.id::text=${q.problemVersionId as string} AND v.sealed AND p.current_version_id=v.id AND (p.owner_id IS NULL OR p.owner_id=${actor.userId}) FOR SHARE OF p,v`,
    )
  ).rows[0];
  if (!found) throw new ApplicationError("not_found", "Question unavailable", 404);
  if (!found.indexed)
    throw new ApplicationError(
      "temporarily_unavailable",
      "Question inputs require normalization",
      503,
    );
  if (
    q.hints !== undefined &&
    q.hints !== null &&
    (typeof q.hints !== "object" ||
      Array.isArray(q.hints) ||
      Object.keys(q.hints).some((k) => !["topics", "complexity"].includes(k)) ||
      Object.values(q.hints).some((v) => v !== null && typeof v !== "boolean"))
  )
    throw fail("Invalid hint visibility");
  return {
    safe: "{}",
    lossless: null,
    source: "",
    language: q.language,
    fingerprint,
    versionId: q.problemVersionId as string,
    published: true,
  };
}

/** Copy only sealed metadata and counts into the active row; case bytes stay indexed. */
export async function writePublishedInterviewQuestion(
  tx: Transaction,
  sessionId: string,
  versionId: string,
  language: string,
  hints: unknown,
): Promise<void> {
  const hint =
    hints == null
      ? null
      : JSON.stringify(
          Object.fromEntries(
            Object.entries(hints as Record<string, unknown>).filter(([, value]) => value !== null),
          ),
        );
  const result = await tx.execute(sql`
    WITH chosen AS (
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'id',v.id,'slug',p.slug,'version',v.version::text,'title',v.title,'difficulty',v.difficulty,
        'statementMarkdown',v.statement_markdown,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,'sql',v.sql_config,'leetcodeId',p.leetcode_id,
        'tags',COALESCE((SELECT jsonb_agg(t.tag ORDER BY t.ordinal) FROM problem_tags t WHERE t.version_id=v.id),'[]'::jsonb),
        'companies',COALESCE((SELECT jsonb_agg(c.name ORDER BY c.name) FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id),'[]'::jsonb),
        'languages',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',x.language,'starterSource',x.starter_source,'runtimeRevision',x.runtime_revision,'harnessRevision',x.harness_revision) ORDER BY x.language) FROM problem_languages x WHERE x.version_id=v.id),'[]'::jsonb),
        'odyssey',CASE WHEN jsonb_typeof(v.odyssey->'levels')='array' THEN jsonb_set(v.odyssey,'{levels}',COALESCE((SELECT jsonb_agg(stage-'examples' ORDER BY n) FROM jsonb_array_elements(v.odyssey->'levels') WITH ORDINALITY z(stage,n)),'[]'::jsonb)) ELSE NULL END
      )) AS metadata,l.starter_source,l.runtime_revision,l.harness_revision,l.reference_source,v.attribution
      FROM runner_version_inputs r JOIN problem_versions v ON v.id=r.version_id JOIN problems p ON p.id=v.problem_id
      JOIN problem_languages l ON l.version_id=v.id AND l.language=${language}
      WHERE r.version_id=${versionId}::uuid AND r.sealed AND v.sealed
    ), counts AS (
      SELECT COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY c.ordinal) FROM runner_version_input_cases c WHERE c.version_id=${versionId}::uuid AND c.channel='example' AND c.stage=0),'[]'::jsonb) AS examples,
      COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY c.ordinal) FROM runner_version_input_cases c WHERE c.version_id=${versionId}::uuid AND c.channel='hidden' AND c.stage=0),'[]'::jsonb) AS hidden
    ), prepared AS (
      SELECT c.*,counts.examples,counts.hidden,CASE WHEN jsonb_typeof(c.metadata->'odyssey'->'levels')='array' THEN
        (SELECT COALESCE(jsonb_agg(COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY q.ordinal) FROM runner_version_input_cases q WHERE q.version_id=${versionId}::uuid AND q.channel='hidden' AND q.stage=n),'[]'::jsonb) ORDER BY n),'[]'::jsonb) FROM generate_series(1,jsonb_array_length(c.metadata->'odyssey'->'levels')) n)
      ELSE '[]'::jsonb END AS suites FROM chosen c CROSS JOIN counts
    )
    UPDATE interviews i SET question = jsonb_build_object(
      'problem',jsonb_set(jsonb_set(jsonb_set(p.metadata,'{examples}',p.examples,true),'{starterSource}',to_jsonb(p.starter_source),true),'{runtimeRevision}',to_jsonb(p.runtime_revision),true),
      'hiddenCases',p.hidden,'odysseyHiddenCases',p.suites,'harnessRevision',COALESCE(p.harness_revision,''),'referenceSource',COALESCE(p.reference_source,''),'attribution',COALESCE(p.attribution,'')
    ) || CASE WHEN ${hint}::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('hints',${hint}::jsonb) END,
    lossless_question=NULL,source=p.starter_source,language=${language}
    FROM prepared p WHERE i.id=${sessionId}::uuid RETURNING i.id`);
  if (!result.rows.length) throw new Error("Sealed question input unavailable");
}
