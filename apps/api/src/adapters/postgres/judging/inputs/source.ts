/** @file source.ts @description Database-derived fixture source identity. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { FixtureOwner } from "./bind.ts";
/**
 * Hash persisted lossless bytes when present. Otherwise hash a domain and eight fixed-width
 * SHA-256 leaves: version metadata, ordered languages, tags, examples, hidden cases,
 * Odyssey stage metadata (without examples), Odyssey stage examples, and Odyssey cases. Each list leaf hashes the
 * concatenation of its ordered per-row SHA-256 values, including ordinals in row JSONB.
 */
export async function fixtureSourceHash(tx: Transaction, owner: FixtureOwner): Promise<Uint8Array> {
  const rows =
    "version" in owner
      ? await tx.execute<{
          hash: Uint8Array;
        }>(sql`SELECT COALESCE(sha256(v.lossless_fixture),sha256(
        convert_to('quorem-version-fixture-v1','UTF8') ||
        sha256(convert_to(jsonb_build_array(v.id,v.problem_id,v.version,v.title,v.difficulty,v.statement_markdown,v.signature,v.constraints,v.limits,v.attribution,v.sql_config,v.odyssey-'levels')::text,'UTF8')) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(l.language,l.starter_source,l.runtime_revision,l.harness_revision,l.reference_source)::text,'UTF8')),''::bytea ORDER BY l.language COLLATE "C") FROM problem_languages l WHERE l.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(t.ordinal,t.tag)::text,'UTF8')),''::bytea ORDER BY t.ordinal) FROM problem_tags t WHERE t.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(e.ordinal,e.args,e.expected,e.explanation,e.calls)::text,'UTF8')),''::bytea ORDER BY e.ordinal) FROM problem_examples e WHERE e.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(c.ordinal,c.args,c.expected,c.calls)::text,'UTF8')),''::bytea ORDER BY c.ordinal) FROM problem_test_cases c WHERE c.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(stage.ordinality-1,stage.value-'examples')::text,'UTF8')),''::bytea ORDER BY stage.ordinality) FROM jsonb_array_elements(COALESCE(v.odyssey->'levels','[]'::jsonb)) WITH ORDINALITY stage(value,ordinality)),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(stage.ordinality-1,e.ordinality-1,e.value)::text,'UTF8')),''::bytea ORDER BY stage.ordinality,e.ordinality) FROM jsonb_array_elements(COALESCE(v.odyssey->'levels','[]'::jsonb)) WITH ORDINALITY stage(value,ordinality), LATERAL jsonb_array_elements(COALESCE(stage.value->'examples','[]'::jsonb)) WITH ORDINALITY e(value,ordinality)),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(convert_to(jsonb_build_array(c.level,c.ordinal,c.case_data)::text,'UTF8')),''::bytea ORDER BY c.level,c.ordinal) FROM problem_odyssey_cases c WHERE c.version_id=v.id),''::bytea))
      )) AS hash FROM problem_versions v WHERE v.id=${owner.version}::uuid`)
      : await tx.execute<{ hash: Uint8Array }>(
          sql`SELECT sha256(COALESCE(lossless_fixture,convert_to(fixture::text,'UTF8'))) AS hash FROM interview_question_snapshots WHERE session_id=${owner.session}::uuid AND id=${owner.fixture}::bytea`,
        );
  const row = rows.rows[0];
  if (!row) throw new Error("Runner fixture unavailable");
  return row.hash;
}
