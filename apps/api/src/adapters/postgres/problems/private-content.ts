/** @file private-content.ts @description Authorized transaction-bound private question snapshots. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  normalizeQuestionDraft,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { object } from "./storage.ts";
type Obj = { [key: string]: JsonValue };
const list = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);
const content = (raw: string): Obj => object(parseLosslessJson(raw));
const bytes = (raw: Uint8Array | null): string | undefined =>
  raw?.length ? new TextDecoder("utf-8", { fatal: true }).decode(raw) : undefined;
async function readPrivateQuestionContent(
  tx: Transaction,
  actorUserId: string,
  id: string,
  allowGlobal: boolean,
  currentOnly: boolean,
): Promise<string | undefined> {
  if (!actorUserId) return undefined;
  const rows = (
    await tx.execute<{
      owner: string | null;
      data: string;
      lossless: Uint8Array | null;
    }>(sql`SELECT p.owner_id AS owner,v.lossless_fixture AS lossless,jsonb_build_object(
 'problem',jsonb_build_object('id',v.id,'slug',p.slug,'version',v.version::text,'title',v.title,'difficulty',v.difficulty,'statementMarkdown',v.statement_markdown,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,'sql',v.sql_config,'odyssey',v.odyssey,'leetcodeId',p.leetcode_id,
 'tags',COALESCE((SELECT jsonb_agg(tag ORDER BY ordinal) FROM problem_tags WHERE version_id=v.id),'[]'::jsonb),
 'companies',COALESCE((SELECT jsonb_agg(c.name ORDER BY c.name) FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id),'[]'::jsonb),
 'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation,'calls',calls) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'::jsonb)),
 'hiddenCases',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'calls',calls) ORDER BY ordinal) FROM problem_test_cases WHERE version_id=v.id),'[]'::jsonb),
 'odysseyHiddenCases',CASE WHEN v.odyssey IS NULL THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(COALESCE((SELECT jsonb_agg(c.case_data ORDER BY c.ordinal) FROM problem_odyssey_cases c WHERE c.version_id=v.id AND c.level=stage.ordinality-1),'[]'::jsonb) ORDER BY stage.ordinality),'[]'::jsonb) FROM jsonb_array_elements(v.odyssey->'levels') WITH ORDINALITY stage(value,ordinality)) END,
 'attribution',v.attribution,
 'implementations',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',language,'starterSource',starter_source,'runtimeRevision',runtime_revision,'harnessRevision',harness_revision,'referenceSource',reference_source) ORDER BY language) FROM problem_languages WHERE version_id=v.id),'[]'::jsonb),
 'solutions',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',language,'source',source,'explanationMarkdown',explanation_markdown,'timeComplexity',time_complexity,'spaceComplexity',space_complexity,'complexityNotes',complexity_notes) ORDER BY language) FROM problem_solutions WHERE version_id=v.id),'[]'::jsonb))::text AS data
 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${id} AND (p.owner_id=${actorUserId} OR (${allowGlobal} AND p.owner_id IS NULL)) AND (NOT ${currentOnly} OR (v.sealed AND p.current_version_id=v.id)) FOR SHARE OF p,v`)
  ).rows;
  if (!rows.length) return undefined;
  const c = content(rows[0].data),
    p = object(c.problem),
    lossless = bytes(rows[0].lossless);
  if (lossless) {
    const f = content(lossless),
      fp = object(f.problem);
    p.examples = fp.examples ?? [];
    c.hiddenCases = f.hiddenCases ?? [];
    c.odysseyHiddenCases = f.odysseyHiddenCases ?? [];
    if (p.odyssey && fp.odyssey) {
      const target = list(object(p.odyssey).levels),
        source = list(object(fp.odyssey).levels);
      for (let i = 0; i < Math.min(target.length, source.length); i++)
        object(target[i]).examples = object(source[i]).examples ?? [];
    }
  }
  if (
    p.odyssey &&
    list(p.examples).length &&
    stringifyLosslessJson(p.examples) ===
      stringifyLosslessJson(object(list(object(p.odyssey).levels)[0]).examples ?? [])
  )
    p.examples = [];
  return normalizeQuestionDraft(stringifyLosslessJson(c));
}
/** Authoring may clone owned private versions or global versions as administrator. */
export function readAuthoringQuestion(
  tx: Transaction,
  actorUserId: string,
  id: string,
  admin: boolean,
): Promise<string | undefined> {
  return readPrivateQuestionContent(tx, actorUserId, id, admin, false);
}
/** Private fixture for authorized current publication; never expose this result publicly. */
export async function readPublishedFixture(
  tx: Transaction,
  actorUserId: string,
  versionId: string,
  language: string,
): Promise<{ content: string; starterSource: string; language: string } | undefined> {
  if (!["python", "java", "typescript", "ocaml", "postgresql"].includes(language)) return undefined;
  const raw = await readPrivateQuestionContent(tx, actorUserId, versionId, true, true);
  if (!raw) return undefined;
  const implementations = list(content(raw).implementations);
  const selected = implementations.map(object).find((value) => value.language === language);
  if (!selected || typeof selected.starterSource !== "string" || !selected.starterSource)
    return undefined;
  return { content: raw, starterSource: selected.starterSource, language };
}
