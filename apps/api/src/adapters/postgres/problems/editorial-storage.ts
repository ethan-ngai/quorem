/** @file editorial-storage.ts @description Shared authorized approach projections; complexity never selects code. @module problems */
import { sql, type SQL } from "drizzle-orm";

export function canonicalApproachProjection(publication: SQL): SQL {
  return sql`COALESCE((SELECT id FROM problem_solution_approaches WHERE publication_id=${publication} AND is_canonical),'')`;
}

export function approachesProjection(publication: SQL, includeCode = true): SQL {
  const code = includeCode
    ? sql`, 'defaultLanguage',a.default_language,'explanationMarkdown',a.explanation_markdown,
    'implementations',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',s.language,'source',s.source) ORDER BY s.language) FROM problem_solutions s WHERE s.publication_id=a.publication_id AND s.approach_id=a.id),'[]'::jsonb)`
    : sql``;
  return sql`COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',a.id,'title',a.title,'timeComplexity',a.time_complexity,'spaceComplexity',a.space_complexity,'complexityNotes',a.complexity_notes ${code})) ORDER BY a.ordinal) FROM problem_solution_approaches a WHERE a.publication_id=${publication} ${includeCode ? sql`` : sql`AND btrim(a.time_complexity)<>'' AND btrim(a.space_complexity)<>''`}), '[]'::jsonb)`;
}
