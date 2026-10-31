/** @file legacy-ranges.ts @description Locked, paged legacy interview fixture boundaries for the operator. @module interviews */
import { Buffer } from "node:buffer";
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { decodeUtf8Chunks, StreamingJsonReader } from "@quorem/questions";
import {
  scanLegacyInterviewFixture,
  type LegacyCaseRange,
  type LegacyFixtureRanges,
} from "../question/published-sidecars.ts";
export type LegacyOwner =
  | { session: string; epoch: string }
  | { session: string; fixture: Uint8Array };
/** Hold the source row lock for scanning, per-case reads, and final hash verification. */
export async function openLegacyFixtureRanges(
  tx: Transaction,
  owner: LegacyOwner,
): Promise<{
  ranges: LegacyFixtureRanges;
  readCase(value: LegacyCaseRange): Promise<string>;
  verify(): Promise<boolean>;
}> {
  const active = "epoch" in owner;
  const relation = active ? sql`interviews x` : sql`interview_question_snapshots x`;
  const predicate = active
    ? sql`x.id=${owner.session}::uuid AND x.question_epoch=${owner.epoch}::uuid`
    : sql`x.session_id=${owner.session}::uuid AND x.id=${owner.fixture}`;
  const source = active
    ? sql`COALESCE(x.lossless_question,convert_to(x.question::text,'UTF8'))`
    : sql`COALESCE(x.lossless_fixture,convert_to(x.fixture::text,'UTF8'))`;
  const locked = (
    await tx.execute<{ hash: Uint8Array }>(
      sql`SELECT sha256(${source}) AS hash FROM ${relation} WHERE ${predicate} ${active ? sql`FOR UPDATE` : sql`FOR SHARE`}`,
    )
  ).rows[0];
  if (!locked) throw new Error("Fixture changed");
  async function* pages(start = 0, length?: number) {
    for (let offset = 0; length === undefined || offset < length; offset += 65536) {
      const count = length === undefined ? 65536 : Math.min(65536, length - offset);
      const row = (
        await tx.execute<{ part: Uint8Array }>(
          sql`SELECT substring(${source} FROM ${start + offset + 1} FOR ${count}) AS part FROM ${relation} WHERE ${predicate}`,
        )
      ).rows[0];
      if (!row || !row.part.length) break;
      yield row.part;
      if (row.part.length < count) break;
    }
  }
  const ranges = await scanLegacyInterviewFixture(
    new StreamingJsonReader(decodeUtf8Chunks(pages())[Symbol.asyncIterator]()),
  );
  return {
    ranges,
    async readCase(value) {
      const pieces: Uint8Array[] = [];
      let size = 0;
      for await (const part of pages(value.start, value.length)) {
        size += part.length;
        pieces.push(part);
      }
      if (size !== value.length) throw new Error("Fixture changed");
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pieces, size));
    },
    async verify() {
      return !!(
        await tx.execute(
          sql`SELECT 1 FROM ${relation} WHERE ${predicate} AND sha256(${source})=${locked.hash}`,
        )
      ).rows.length;
    },
  };
}
