/** @file backfill.ts @description Privileged, transaction-bound legacy result normalization. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { JsonNumber, stringifyLosslessJson, type JsonValue } from "@quorem/questions";
import { scanLegacyCase, writeLegacyCase, legacyKey } from "./legacy-case.ts";
import {
  legacyHeaderArray,
  legacyHeaderString,
  legacyScore,
  validateLegacyHeader,
} from "./legacy-header.ts";
import { StreamingJsonReader } from "@quorem/questions";
import { spoolLegacySource } from "./legacy-sql.ts";
import { publicResult } from "./projection.ts";
import { backfillPrivateResultCases } from "../../interviews/question/private-results.ts";
const decoder = () => new TextDecoder("utf-8", { fatal: true });
/** Locks one terminal submission until every normalized row and its header commit together. */
export async function backfillSubmissionResult(tx: Transaction, id: string): Promise<boolean> {
  const row = (
    await tx.execute<{ kind: string; length: number | null; digest: Uint8Array | null }>(
      sql`SELECT kind,octet_length(COALESCE(result_payload,convert_to(result::text,'UTF8')))::int AS length,sha256(COALESCE(result_payload,convert_to(result::text,'UTF8'))) AS digest FROM submissions WHERE id=${id}::uuid AND state IN ('completed','failed','cancelled') AND result IS NOT NULL FOR UPDATE`,
    )
  ).rows[0];
  if (!row || row.length === null) return false;
  await tx.execute(sql`SELECT set_config('quorem.result_backfill','v1',true)`);
  await spoolLegacySource(tx, id, "public");
  async function* bytes(length: number): AsyncGenerator<string> {
    const decode = decoder();
    for (let offset = 1; offset <= length; offset += 65536) {
      const q = sql`SELECT substring(raw FROM ${offset} FOR 65536) AS data FROM quorem_legacy_source WHERE id=${id}::uuid AND kind='public'`;
      const part = (await tx.execute<{ data: Uint8Array }>(q)).rows[0];
      if (!part) throw new Error("Legacy result changed");
      yield decode.decode(part.data, { stream: true });
    }
    const tail = decode.decode();
    if (tail) yield tail;
  }
  const input = new StreamingJsonReader(bytes(row.length)[Symbol.asyncIterator]());
  const fields: { [key: string]: JsonValue } = {};
  let present = false,
    count = 0,
    hiddenCaseCount = 0;
  const flags: Record<string, boolean> = {};
  const seen = new Set<string>();
  const channel = row.kind === "run" ? "public" : "sample";
  await input.expect("{");
  while ((await input.peek()) !== "}") {
    const key = await legacyKey(input);
    if (
      [
        "publicCases",
        "hiddenCases",
        "verdict",
        "infrastructureError",
        "score",
        "diagnostics",
      ].includes(key)
    ) {
      if (seen.has(key)) throw new Error("Duplicate legacy result field");
      seen.add(key);
    }
    await input.expect(":");
    if (key === "publicCases" && (await input.peek()) === "[") {
      await input.expect("[");
      let ordinal = 0;
      while ((await input.peek()) !== "]") {
        await writeLegacyCase(tx, id, channel, ordinal++, await scanLegacyCase(tx, input));
        if ((await input.peek()) === ",") await input.expect(",");
        else break;
      }
      await input.expect("]");
      present = true;
      count = ordinal;
    } else if ((key === "hiddenCases" || key === "diagnostics") && (await input.peek()) === "[") {
      const n = await legacyHeaderArray(tx, id, key, input);
      flags[key + "Present"] = true;
      if (key === "hiddenCases") hiddenCaseCount = n;
    } else if (key === "verdict" || key === "infrastructureError") {
      await legacyHeaderString(tx, id, key, input);
      flags[key + "Present"] = true;
    } else if (key === "score" && (await input.peek()) === "{")
      fields.score = await legacyScore(tx, id, input);
    else if (["publicCases", "hiddenCases", "diagnostics", "score"].includes(key)) {
      if ((await input.value()) !== "null") throw new Error("Invalid legacy result field");
    } else await input.value(false);
    if ((await input.peek()) === ",") await input.expect(",");
    else break;
  }
  await input.expect("}");
  if (await input.peek()) throw new Error("Trailing legacy result data");
  await validateLegacyHeader(tx, id);
  const projected = publicResult(new TextEncoder().encode(stringifyLosslessJson(fields)), false);
  const header = new TextEncoder().encode(
    stringifyLosslessJson({
      ...projected,
      ...flags,
      ...(flags.hiddenCasesPresent
        ? { hiddenCaseCount: new JsonNumber(String(hiddenCaseCount)) }
        : {}),
      publicCasesPresent: present,
      publicCaseCount: new JsonNumber(String(count)),
      channel,
    }),
  );
  await backfillPrivateResultCases(tx, id);
  const stable = await tx.execute<{ ok: boolean }>(
    sql`SELECT result IS NOT NULL AND sha256(COALESCE(result_payload,convert_to(result::text,'UTF8'))) IS NOT DISTINCT FROM ${row.digest} AS ok FROM submissions WHERE id=${id}::uuid`,
  );
  if (!stable.rows[0]?.ok) throw new Error("Legacy result changed");
  const inserted = await tx.execute(
    sql`INSERT INTO submission_result_headers(submission_id,header_data) VALUES(${id}::uuid,${header}) ON CONFLICT DO NOTHING RETURNING submission_id`,
  );
  if (
    !inserted.rows.length &&
    !(
      await tx.execute<{ ok: boolean }>(
        sql`SELECT header_data=${header} AS ok FROM submission_result_headers WHERE submission_id=${id}::uuid`,
      )
    ).rows[0]?.ok
  )
    throw new Error("Result header conflict");
  return true;
}

/** Operator-only batch; each submission commits independently within the caller's bounded connection lifetime. */
export async function backfillSubmissionBatch(
  run: <T>(
    fn: (scope: Pick<import("@quorem/database/core").ConnectionScope, "transaction">) => Promise<T>,
  ) => Promise<T>,
  limit = 16,
): Promise<{ attempted: number; completed: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError("Invalid backfill limit");
  const options = { statementTimeoutMs: 30000, lockTimeoutMs: 1000 };
  const rows = await run((scope) =>
    scope.transaction(
      { ...options, readOnly: true },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`SELECT s.id::text FROM submissions s WHERE s.state IN ('completed','failed','cancelled') AND s.result IS NOT NULL AND NOT EXISTS (SELECT 1 FROM submission_result_headers h WHERE h.submission_id=s.id) ORDER BY s.id LIMIT ${limit}`,
          )
        ).rows,
    ),
  );
  let completed = 0;
  for (const row of rows)
    if (
      await run((scope) => scope.transaction(options, (tx) => backfillSubmissionResult(tx, row.id)))
    )
      completed++;
  return { attempted: rows.length, completed };
}
