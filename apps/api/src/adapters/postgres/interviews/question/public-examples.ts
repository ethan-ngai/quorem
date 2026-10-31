/** @file public-examples.ts @description Epoch-fenced public case sidecars. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { jsonObject } from "../../problems/queries/public-projection.ts";
type Obj = { [key: string]: JsonValue };
const list = (v: JsonValue | undefined): JsonValue[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error("Invalid public examples");
  return v;
};
function publicCases(value: JsonValue | undefined): JsonValue[] {
  return list(value).map((item) => {
    const source = jsonObject(item),
      out: Obj = {};
    for (const key of ["args", "expected", "calls", "explanation"])
      if (source[key] !== undefined) out[key] = source[key];
    if (out.calls !== undefined)
      out.calls = list(out.calls).map((call) => {
        const sourceCall = jsonObject(call),
          result: Obj = {};
        for (const key of ["methodName", "args", "expected"])
          if (sourceCall[key] !== undefined) result[key] = sourceCall[key];
        return result;
      });
    return out;
  });
}
/** Parse privileged fixture once and retain only public case values. */
export function splitPublicExamples(raw: string): Uint8Array[] {
  const root = jsonObject(parseLosslessJson(raw)),
    problem = jsonObject(root.problem),
    encoder = new TextEncoder();
  const rows = [encoder.encode(stringifyLosslessJson(publicCases(problem.examples)))];
  if (problem.odyssey !== undefined && problem.odyssey !== null) {
    if (problem.odyssey instanceof JsonNumber) throw new Error("Invalid Odyssey");
    const levels = list(jsonObject(problem.odyssey).levels);
    if (!levels.length) throw new Error("Invalid Odyssey levels");
    for (const level of levels)
      rows.push(encoder.encode(stringifyLosslessJson(publicCases(jsonObject(level).examples))));
  }
  return rows;
}
/** Call in the same transaction as the question epoch write. */
export async function savePublicExamples(
  tx: Transaction,
  id: string,
  epoch: string,
  raw: string,
): Promise<void> {
  const parts = splitPublicExamples(raw);
  for (const [level, examples] of parts.entries())
    if (
      !(
        await tx.execute(
          sql`INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) VALUES(${id}::uuid,${epoch}::uuid,${level},${examples}) ON CONFLICT(session_id,question_epoch,level) DO UPDATE SET examples=EXCLUDED.examples WHERE interview_public_examples.examples=EXCLUDED.examples RETURNING level`,
        )
      ).rows.length
    )
      throw new Error("Public example conflict");
}
/** Call atomically when creating or backfilling an immutable admitted fixture. */
export async function saveSnapshotPublicExamples(
  tx: Transaction,
  id: string,
  fixtureId: Uint8Array,
  raw: string,
): Promise<void> {
  const parts = splitPublicExamples(raw);
  for (const [level, examples] of parts.entries())
    if (
      !(
        await tx.execute(
          sql`INSERT INTO interview_snapshot_public_examples(session_id,fixture_id,level,examples) VALUES(${id}::uuid,${fixtureId},${level},${examples}) ON CONFLICT(session_id,fixture_id,level) DO UPDATE SET examples=EXCLUDED.examples WHERE interview_snapshot_public_examples.examples=EXCLUDED.examples RETURNING level`,
        )
      ).rows.length
    )
      throw new Error("Public example conflict");
}
/** Privileged operator primitive; caller supplies one observed epoch per bounded transaction. */
export async function backfillInterviewPublicExamples(
  tx: Transaction,
  id: string,
  expectedEpoch: string,
): Promise<boolean> {
  const row = (
    await tx.execute<{ epoch: string; raw: Uint8Array }>(
      sql`SELECT question_epoch::text AS epoch,COALESCE(lossless_question,convert_to(question::text,'UTF8')) AS raw FROM interviews WHERE id=${id}::uuid FOR UPDATE`,
    )
  ).rows[0];
  if (!row || row.epoch !== expectedEpoch) return false;
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(row.raw);
  await savePublicExamples(tx, id, row.epoch, raw);
  await savePrivateCases(tx, id, row.epoch, raw);
  return true;
}
/** Privileged operator primitive for one immutable historical fixture. */
export async function backfillSnapshotPublicExamples(
  tx: Transaction,
  id: string,
  fixtureId: Uint8Array,
): Promise<boolean> {
  const row = (
    await tx.execute<{ raw: Uint8Array }>(
      sql`SELECT COALESCE(lossless_fixture,convert_to(fixture::text,'UTF8')) AS raw FROM interview_question_snapshots WHERE session_id=${id}::uuid AND id=${fixtureId} FOR SHARE`,
    )
  ).rows[0];
  if (!row) return false;
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(row.raw);
  await saveSnapshotPublicExamples(tx, id, fixtureId, raw);
  const expected = privateCases(raw).length;
  const epochs =
    expected === 0
      ? []
      : (
          await tx.execute<{ epoch: string }>(
            sql`SELECT DISTINCT e.question_epoch::text AS epoch FROM interview_execution e WHERE e.session_id=${id}::uuid AND e.fixture_id=${fixtureId} AND (SELECT count(*) FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch)<${expected} LIMIT 16`,
          )
        ).rows;
  for (const { epoch } of epochs) await savePrivateCases(tx, id, epoch, raw);
  return true;
}
function privateCases(raw: string): { id: string; value: JsonValue }[] {
  const root = jsonObject(parseLosslessJson(raw)),
    problem = jsonObject(root.problem),
    cases: { id: string; value: JsonValue }[] = [];
  if (problem.odyssey !== undefined && problem.odyssey !== null) {
    const levels = list(jsonObject(problem.odyssey).levels),
      suites = list(root.odysseyHiddenCases);
    if (levels.length !== suites.length) throw new Error("Invalid private stages");
    for (const [level, suite] of suites.entries())
      for (const [index, value] of list(suite).entries())
        cases.push({ id: `level:${level + 1}:case:${index}`, value });
  } else
    for (const [index, value] of list(root.hiddenCases).entries())
      cases.push({ id: `hidden:${index}`, value });
  return cases;
}
/** Preserve canonical private case IDs and order for role- or reveal-scoped reads. */
export async function savePrivateCases(
  tx: Transaction,
  id: string,
  epoch: string,
  raw: string,
): Promise<void> {
  const cases = privateCases(raw);
  const encoder = new TextEncoder();
  for (const [ordinal, item] of cases.entries()) {
    const source = jsonObject(item.value),
      safe: Obj = {};
    for (const key of ["args", "expected", "calls"])
      if (source[key] !== undefined) safe[key] = source[key];
    if (safe.calls !== undefined)
      safe.calls = list(safe.calls).map((call) => {
        const c = jsonObject(call),
          out: Obj = {};
        for (const key of ["methodName", "args", "expected"])
          if (c[key] !== undefined) out[key] = c[key];
        return out;
      });
    const bytes = encoder.encode(stringifyLosslessJson(safe));
    const result = await tx.execute(
      sql`INSERT INTO interview_question_private_cases(session_id,question_epoch,case_id,ordinal,case_data) VALUES(${id}::uuid,${epoch}::uuid,${item.id},${ordinal},${bytes}) ON CONFLICT(session_id,question_epoch,case_id) DO UPDATE SET case_data=EXCLUDED.case_data WHERE interview_question_private_cases.ordinal=EXCLUDED.ordinal AND interview_question_private_cases.case_data=EXCLUDED.case_data RETURNING case_id`,
    );
    if (!result.rows.length) throw new Error("Private case conflict");
  }
}
/** Immutable fixture reader consumes only the authorized stage prefix. */
export async function readSnapshotPublicExamples(
  tx: Transaction,
  id: string,
  fixtureId: Uint8Array,
  totalStages: number,
  unlocked: number,
): Promise<JsonValue[]> {
  if (
    !Number.isInteger(totalStages) ||
    totalStages < 0 ||
    !Number.isInteger(unlocked) ||
    unlocked < 0 ||
    unlocked > totalStages
  )
    throw new Error("Invalid stage range");
  const count = (
    await tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM interview_snapshot_public_examples WHERE session_id=${id}::uuid AND fixture_id=${fixtureId} AND level BETWEEN 0 AND ${totalStages}`,
    )
  ).rows[0];
  if (Number(count.count) !== totalStages + 1)
    throw new Error("Interview snapshot examples require backfill");
  const rows = (
    await tx.execute<{ level: number; examples: Uint8Array }>(
      sql`SELECT level,examples FROM interview_snapshot_public_examples WHERE session_id=${id}::uuid AND fixture_id=${fixtureId} AND level BETWEEN 0 AND ${unlocked} ORDER BY level`,
    )
  ).rows;
  if (rows.length !== unlocked + 1 || rows.some((row, index) => row.level !== index))
    throw new Error("Interview snapshot examples require backfill");
  return rows.map((row) =>
    parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(row.examples)),
  );
}
