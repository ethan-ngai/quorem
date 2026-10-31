/** @file interview.ts @description Interviewer and revealed-case result projection. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { JsonNumber, parseLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { object, resultCase } from "./projection.ts";
type Obj = { [key: string]: JsonValue };
const missing = () => new ApplicationError("not_found", "Execution unavailable", 404);
type Access = { role: string; epoch: string };
export async function interviewAccess(
  tx: Transaction,
  who: Principal,
  id: string,
): Promise<Access> {
  if (who.kind === "guest" && (who.scope.kind !== "interview" || who.scope.interviewId !== id))
    throw missing();
  const row = (
    await tx.execute<Access>(
      sql`SELECT m.role,i.question_epoch::text AS epoch FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL JOIN users host ON host.id=i.host_id AND NOT host.disabled WHERE i.id=${id}::uuid AND i.deleted_at IS NULL FOR SHARE OF i,m,host`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
function list(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Invalid interview result list");
  return value;
}
function select(value: JsonValue, fields: readonly string[]): Obj {
  const src = object(value),
    out: Obj = {};
  for (const key of fields) if (src[key] !== undefined) out[key] = src[key];
  return out;
}
function caseValue(value: JsonValue): Obj {
  const result = select(value, ["args", "expected", "calls"]);
  if (result.calls !== undefined)
    result.calls = list(result.calls).map((call) =>
      select(call, ["methodName", "args", "expected"]),
    );
  return result;
}
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
      fixture: Uint8Array;
      results: Uint8Array | null;
      epoch: string;
      level: number;
    }>(
      sql`SELECT COALESCE(q.lossless_fixture,convert_to(q.fixture::text,'UTF8')) AS fixture,COALESCE(e.private_results_payload,convert_to(e.private_results::text,'UTF8')) AS results,e.question_epoch::text AS epoch,e.level FROM interview_execution e JOIN interview_question_snapshots q ON q.session_id=e.session_id AND q.id=e.fixture_id WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid`,
    )
  ).rows[0];
  if (!row) throw missing();
  if (access.role !== "interviewer" && row.epoch !== access.epoch) return value;
  const decode = (bytes: Uint8Array) =>
    parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const fixture = object(decode(row.fixture)),
    problem = object(fixture.problem),
    odyssey = problem.odyssey !== undefined && problem.odyssey !== null;
  const candidates: { id: string; value: JsonValue }[] = [];
  if (odyssey) {
    const levels = list(fixture.odysseyHiddenCases);
    for (let level = 0; level < Math.min(row.level, levels.length); level++)
      for (const [index, test] of list(levels[level]).entries())
        candidates.push({ id: `level:${level + 1}:case:${index}`, value: test });
  } else
    for (const [index, test] of list(fixture.hiddenCases).entries())
      candidates.push({ id: `hidden:${index}`, value: test });
  const fallback = !odyssey && candidates.length === 0;
  if (fallback)
    for (const [index, test] of list(problem.examples).entries())
      candidates.push({ id: `example:${index}`, value: test });
  const revealed = new Set(
    (
      await tx.execute<{ id: string }>(
        sql`SELECT case_id AS id FROM interview_case_visibility WHERE session_id=${interviewId}::uuid AND question_epoch=${row.epoch}::uuid`,
      )
    ).rows.map((r) => r.id),
  );
  const results = row.results ? list(decode(row.results)) : [];
  if (!results.length && (value.state !== "completed" || hidden.length !== candidates.length))
    return value;
  const output: JsonValue[] = [];
  for (const [index, test] of candidates.entries()) {
    if (access.role !== "interviewer" && !fallback && !revealed.has(test.id)) continue;
    const source = results[index] ?? hidden[index];
    const safe =
      source === undefined ? { index: new JsonNumber(String(index)) } : resultCase(source, false);
    output.push({ caseId: test.id, case: caseValue(test.value), ...safe });
  }
  if (output.length) value.privateCaseResults = output;
  return value;
}
