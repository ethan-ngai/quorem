/** @file private-results.ts @description Fenced per-case private result storage. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { parseLosslessJson, stringifyLosslessJson } from "@quorem/questions";
import { resultCase } from "../../judging/results/projection.ts";
/** Called in the completion transaction before publishing the submission result. */
export async function savePrivateResultCases(
  tx: Transaction,
  id: string,
  raw: string,
): Promise<void> {
  const value = parseLosslessJson(raw);
  if (!Array.isArray(value)) throw new Error("Invalid private results");
  for (const [ordinal, item] of value.entries()) {
    const data = new TextEncoder().encode(stringifyLosslessJson(resultCase(item, false)));
    const result = await tx.execute(
      sql`INSERT INTO interview_private_result_cases(submission_id,ordinal,result_data) VALUES(${id}::uuid,${ordinal},${data}) ON CONFLICT(submission_id,ordinal) DO UPDATE SET result_data=EXCLUDED.result_data WHERE interview_private_result_cases.result_data=EXCLUDED.result_data RETURNING ordinal`,
    );
    if (!result.rows.length) throw new Error("Private result conflict");
  }
}
/** Privileged, bounded to one submission; the lock serializes with result completion. */
export async function backfillPrivateResultCases(tx: Transaction, id: string): Promise<boolean> {
  const row = (
    await tx.execute<{ raw: Uint8Array | null }>(
      sql`SELECT COALESCE(e.private_results_payload,convert_to(e.private_results::text,'UTF8')) AS raw FROM interview_execution e JOIN submissions s ON s.id=e.submission_id WHERE e.submission_id=${id}::uuid AND s.state IN ('completed','failed','cancelled') FOR UPDATE OF e,s`,
    )
  ).rows[0];
  if (!row) return false;
  if (row.raw)
    await savePrivateResultCases(tx, id, new TextDecoder("utf-8", { fatal: true }).decode(row.raw));
  return true;
}
