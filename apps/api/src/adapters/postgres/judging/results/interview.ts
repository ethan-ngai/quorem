/** @file interview.ts @description Authorized per-case interview result projection. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { JsonNumber, parseLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { readSnapshotPublicExamples } from "../../interviews/question/public-examples.ts";
import { object, resultCase } from "./projection.ts";
type Obj = { [key: string]: JsonValue };
const missing = () => new ApplicationError("not_found", "Execution unavailable", 404);
type Access = { role: string; epoch: string; userId: string };
export async function interviewAccess(
  tx: Transaction,
  who: Principal,
  id: string,
): Promise<Access> {
  if (who.kind === "guest" && (who.scope.kind !== "interview" || who.scope.interviewId !== id))
    throw missing();
  const row = (
    await tx.execute<{ role: string; epoch: string }>(
      sql`SELECT m.role,i.question_epoch::text AS epoch FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL JOIN users host ON host.id=i.host_id AND NOT host.disabled WHERE i.id=${id}::uuid AND i.deleted_at IS NULL FOR SHARE OF i,m,host`,
    )
  ).rows[0];
  if (!row) throw missing();
  return { ...row, userId: who.userId };
}
function list(v: JsonValue | undefined): JsonValue[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error("Invalid result list");
  return v;
}
function caseValue(value: JsonValue): Obj {
  const source = object(value),
    safe: Obj = {};
  for (const key of ["args", "expected", "calls"])
    if (source[key] !== undefined) safe[key] = source[key];
  if (safe.calls !== undefined)
    safe.calls = list(safe.calls).map((item) => {
      const call = object(item),
        out: Obj = {};
      for (const key of ["methodName", "args", "expected"])
        if (call[key] !== undefined) out[key] = call[key];
      return out;
    });
  return safe;
}
/** No public path reads the opaque private fixture or full private result payload. */
export async function interviewProjection(
  tx: Transaction,
  access: Access,
  interviewId: string,
  id: string,
  kind: string,
  value: Obj,
): Promise<Obj> {
  const hidden = list(value.hiddenCases);
  if (access.role !== "interviewer" && kind === "submit") {
    delete value.hiddenCases;
    delete value.diagnostics;
  }
  if (kind !== "submit") return value;
  const row = (
    await tx.execute<{
      epoch: string;
      level: number;
      fixture: Uint8Array;
      stages: number;
      ids: string[];
      examples: number;
      resultCount: number;
    }>(
      sql`SELECT e.question_epoch::text AS epoch,e.level,e.fixture_id AS fixture,q.total_stages AS stages,q.private_ids AS ids,q.example_count AS examples,e.result_count AS "resultCount" FROM interview_execution_public e JOIN interview_snapshot_public q ON q.session_id=e.session_id AND q.fixture_id=e.fixture_id WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid`,
    )
  ).rows[0];
  if (!row) throw missing();
  if (access.role !== "interviewer" && row.epoch !== access.epoch) return value;
  const publicRows = await readSnapshotPublicExamples(tx, interviewId, row.fixture, row.stages, 0);
  const metadata = (
    await tx.execute<{ ids: string[]; ordinals: number[] }>(
      sql`SELECT ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=${interviewId}::uuid AND c.question_epoch=${row.epoch}::uuid ORDER BY c.ordinal) AS ids,ARRAY(SELECT r.ordinal FROM interview_private_result_cases r WHERE r.submission_id=${id}::uuid ORDER BY r.ordinal) AS ordinals`,
    )
  ).rows[0];
  if (
    metadata.ids.length !== row.ids.length ||
    metadata.ids.some((v, i) => v !== row.ids[i]) ||
    metadata.ordinals.length !== row.resultCount ||
    metadata.ordinals.some((v, i) => v !== i)
  )
    throw new Error("Interview private results require backfill");
  const eligible = row.stages
    ? row.ids.filter((caseId) => {
        const match = /^level:(\d+):case:\d+$/.exec(caseId);
        return !!match && Number(match[1]) <= row.level;
      })
    : row.ids;
  const fallback = row.stages === 0 && eligible.length === 0;
  const candidates = fallback ? row.examples : eligible.length;
  if (row.resultCount === 0 && (value.state !== "completed" || hidden.length !== candidates))
    return value;
  const decode = (bytes: Uint8Array) =>
    parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const output: JsonValue[] = [];
  if (fallback) {
    const examples = list(publicRows[0]);
    if (examples.length !== row.examples)
      throw new Error("Interview public results require backfill");
    const results = (
      await tx.execute<{ ordinal: number; data: Uint8Array }>(
        sql`SELECT r.ordinal,r.result_data AS data FROM interview_private_result_cases r JOIN interview_execution_public e ON e.submission_id=r.submission_id JOIN interviews i ON i.id=e.session_id JOIN interview_members m ON m.session_id=i.id AND m.user_id=${access.userId} AND m.removed_at IS NULL WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND (m.role='interviewer' OR i.question_epoch=e.question_epoch) ORDER BY r.ordinal`,
      )
    ).rows;
    const byIndex = new Map(results.map((result) => [result.ordinal, result.data]));
    for (const [index, test] of examples.entries()) {
      const source = byIndex.get(index),
        result = source
          ? resultCase(decode(source), false)
          : hidden[index] === undefined
            ? { index: new JsonNumber(String(index)) }
            : resultCase(hidden[index], false);
      output.push({ caseId: `example:${index}`, case: caseValue(test), ...result });
    }
  } else {
    const columns = sql`c.case_id AS id,c.ordinal,c.case_data AS data,r.result_data AS result`;
    const selected =
      access.role === "interviewer"
        ? await tx.execute<{
            id: string;
            ordinal: number;
            data: Uint8Array;
            result: Uint8Array | null;
          }>(
            sql`SELECT ${columns} FROM interview_question_private_cases c JOIN interview_execution_public e ON e.session_id=c.session_id AND e.question_epoch=c.question_epoch JOIN interviews i ON i.id=e.session_id JOIN interview_members m ON m.session_id=i.id AND m.user_id=${access.userId} AND m.removed_at IS NULL AND m.role='interviewer' LEFT JOIN interview_private_result_cases r ON r.submission_id=e.submission_id AND r.ordinal=c.ordinal WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND c.ordinal<${candidates} ORDER BY c.ordinal`,
          )
        : await tx.execute<{
            id: string;
            ordinal: number;
            data: Uint8Array;
            result: Uint8Array | null;
          }>(
            sql`SELECT ${columns} FROM interview_question_private_cases c JOIN interview_execution_public e ON e.session_id=c.session_id AND e.question_epoch=c.question_epoch JOIN interviews i ON i.id=e.session_id AND i.question_epoch=e.question_epoch JOIN interview_members m ON m.session_id=i.id AND m.user_id=${access.userId} AND m.removed_at IS NULL JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id LEFT JOIN interview_private_result_cases r ON r.submission_id=e.submission_id AND r.ordinal=c.ordinal WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND c.ordinal<${candidates} ORDER BY c.ordinal`,
          );
    for (const item of selected.rows) {
      const source = item.result
        ? resultCase(decode(item.result), false)
        : hidden[item.ordinal] === undefined
          ? { index: new JsonNumber(String(item.ordinal)) }
          : resultCase(hidden[item.ordinal], false);
      output.push({ caseId: item.id, case: caseValue(decode(item.data)), ...source });
    }
  }
  if (output.length) value.privateCaseResults = output;
  return value;
}
