/** @file embeddings.ts @description Revision-bound vector persistence; no remote inference. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  encoder,
  embeddingSpec,
  type LearningQuestion,
} from "../../../../modules/problems/recommendations/model.ts";
export function normalizedEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === embeddingSpec.dimensions &&
    value.every((x) => typeof x === "number" && Number.isFinite(x)) &&
    Math.abs(value.reduce((sum, x) => sum + x * x, 0) - 1) < 0.01
  );
}
export async function attachEmbeddings<T extends LearningQuestion>(
  tx: Transaction,
  questions: T[],
): Promise<T[]> {
  if (!questions.length) return questions;
  const keys = [...new Set(questions.map((q) => q.key))];
  const rows = (
    await tx.execute<{ key: string; embedding: unknown }>(
      sql`SELECT content_key AS key,embedding FROM question_embeddings WHERE encoder=${encoder} AND content_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`,
    )
  ).rows;
  const vectors = new Map(
    rows
      .filter((row) => normalizedEmbedding(row.embedding))
      .map((row) => [row.key, row.embedding as number[]]),
  );
  return questions.map((q) => ({ ...q, embedding: vectors.get(q.key) }));
}
export type EncodingInput = { id: string; key: string; text: string };
export async function pendingEmbeddings(tx: Transaction, limit = 32): Promise<EncodingInput[]> {
  return (
    await tx.execute<EncodingInput>(sql`SELECT v.id::text AS id,recommendation_content_key(v.id) AS key,
    v.title||E'\n'||COALESCE((SELECT string_agg(tag,', ' ORDER BY ordinal) FROM problem_tags WHERE version_id=v.id),'')||E'\n'||left(v.statement_markdown,12000) AS text
    FROM problems p JOIN problem_versions v ON v.id=p.current_version_id
    WHERE NOT EXISTS(SELECT 1 FROM question_embeddings b WHERE b.version_id=v.id AND b.content_key=recommendation_content_key(v.id) AND b.encoder=${encoder})
    ORDER BY v.id LIMIT ${limit}`)
  ).rows;
}
/** Inference runs outside transactions; conditional insert discards edits/deletions during encoding. */
export async function saveEmbedding(
  tx: Transaction,
  input: EncodingInput,
  embedding: number[],
): Promise<boolean> {
  if (!normalizedEmbedding(embedding)) throw new Error("Invalid question embedding");
  const result =
    await tx.execute(sql`INSERT INTO question_embeddings(version_id,content_key,encoder,embedding)
    SELECT v.id,${input.key},${encoder},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(embedding)}::jsonb)::real)
    FROM problems p JOIN problem_versions v ON v.id=p.current_version_id
    WHERE v.id=${input.id}::uuid AND recommendation_content_key(v.id)=${input.key}
    ON CONFLICT DO NOTHING RETURNING version_id`);
  return !!result.rowCount;
}
