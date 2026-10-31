/** @file private-results.ts @description Fenced per-case private result storage. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "@quorem/questions";
import { resultCase } from "../../judging/results/projection.ts";
import { scanLegacyCase, writeLegacyCase } from "../../judging/results/legacy-case.ts";
import { LegacyJsonReader } from "../../judging/results/legacy-json.ts";
async function saveCase(
  tx: Transaction,
  id: string,
  ordinal: number,
  item: JsonValue,
): Promise<void> {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 2147483647)
    throw new RangeError("Invalid private result ordinal");
  const data = new TextEncoder().encode(stringifyLosslessJson(resultCase(item, false)));
  const result = await tx.execute(
    sql`INSERT INTO interview_private_result_cases(submission_id,ordinal,result_data) VALUES(${id}::uuid,${ordinal},${data}) ON CONFLICT(submission_id,ordinal) DO NOTHING RETURNING ordinal`,
  );
  if (!result.rows.length) {
    const existing = await tx.execute<{ matches: boolean }>(
      sql`SELECT result_data=${data} AS matches FROM interview_private_result_cases WHERE submission_id=${id}::uuid AND ordinal=${ordinal}`,
    );
    if (!existing.rows[0]?.matches) throw new Error("Private result conflict");
  }
}
/** Write one lossless case inside the transaction that publishes completion. */
export async function savePrivateResultCase(
  tx: Transaction,
  id: string,
  ordinal: number,
  raw: string,
): Promise<void> {
  await saveCase(tx, id, ordinal, parseLosslessJson(raw));
}
/** Privileged, terminal-only normalization; each source read is bounded. */
export async function backfillPrivateResultCases(tx: Transaction, id: string): Promise<boolean> {
  const row = (
    await tx.execute<{ length: number | null; expected: number }>(
      sql`SELECT octet_length(COALESCE(e.private_results_payload,convert_to(e.private_results::text,'UTF8')))::int AS length,CASE WHEN jsonb_typeof(e.private_results)='array' THEN jsonb_array_length(e.private_results) ELSE 0 END AS expected FROM interview_execution e JOIN submissions s ON s.id=e.submission_id WHERE e.submission_id=${id}::uuid AND s.state IN ('completed','failed','cancelled') AND s.result IS NOT NULL FOR UPDATE OF e,s`,
    )
  ).rows[0];
  if (!row) return false;
  if (row.length === null) return true;
  await tx.execute(sql`SELECT set_config('quorem.result_backfill','v1',true)`);
  async function* chunks(): AsyncGenerator<string> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let offset = 1; offset <= row!.length!; offset += 65536) {
      const data = (
        await tx.execute<{ data: Uint8Array }>(
          sql`SELECT substring(COALESCE(private_results_payload,convert_to(private_results::text,'UTF8')) FROM ${offset} FOR 65536) AS data FROM interview_execution WHERE submission_id=${id}::uuid`,
        )
      ).rows[0].data;
      yield decoder.decode(data, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  }
  async function normalize(): Promise<void> {
    const input = new LegacyJsonReader(chunks()[Symbol.asyncIterator]());
    if ((await input.peek()) !== "[") {
      let token = "";
      for await (const part of input.valueChunks()) {
        if (token.length <= 4) token += part;
      }
      if (token !== "null" || row!.expected !== 0) throw new Error("Invalid private results");
      return;
    }
    await input.expect("[");
    let ordinal = 0;
    while ((await input.peek()) !== "]") {
      await writeLegacyCase(tx, id, "private", ordinal++, await scanLegacyCase(tx, input));
      if ((await input.peek()) === ",") await input.expect(",");
      else break;
    }
    await input.expect("]");
    if ((await input.peek()) || ordinal !== row!.expected)
      throw new Error("Private result count mismatch");
    const actual = (
      await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM interview_private_result_cases WHERE submission_id=${id}::uuid`,
      )
    ).rows[0].count;
    if (actual !== ordinal) throw new Error("Invalid or conflicting legacy case");
  }
  await normalize();
  return true;
}
