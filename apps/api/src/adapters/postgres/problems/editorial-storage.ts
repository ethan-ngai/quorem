/** @file editorial-storage.ts @description Shared authorized approach projections; complexity never selects code. @module problems */
import { sql, type SQL } from "drizzle-orm";

export function canonicalApproachProjection(publication: SQL): SQL {
  return sql`COALESCE((SELECT id FROM problem_solution_approaches WHERE publication_id=${publication} AND is_canonical),'')`;
}

export function approachesProjection(publication: SQL): SQL {
  return sql`COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',a.id,'title',a.title,'timeComplexity',a.time_complexity,'spaceComplexity',a.space_complexity,
    'complexityNotes',a.complexity_notes,'defaultLanguage',a.default_language,
    'explanationMarkdown',a.explanation_markdown,
    'implementations',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',s.language,'source',s.source) ORDER BY s.language) FROM problem_solutions s WHERE s.publication_id=a.publication_id AND s.approach_id=a.id),'[]'::jsonb)
  )) ORDER BY a.ordinal) FROM problem_solution_approaches a WHERE a.publication_id=${publication}), '[]'::jsonb)`;
}

export function optimalComplexityProjection(publication: SQL): SQL {
  return sql`(SELECT jsonb_build_object('timeComplexity',time_complexity,'spaceComplexity',space_complexity)
    FROM problem_solution_approaches
    WHERE publication_id=${publication} AND is_canonical
      AND btrim(time_complexity) ~ '^[$]?(O|Θ)[[:space:]]*[(][^$[:cntrl:]]+[)][$]?$'
      AND btrim(space_complexity) ~ '^[$]?(O|Θ)[[:space:]]*[(][^$[:cntrl:]]+[)][$]?$')`;
}

/** Keep profile metadata and editorial approach identities out of the hint response. */
export function complexityProjection(publication: SQL, policy: SQL = sql`'efficient'`): SQL {
  const profiles = sql`${publication}.acceptance`;
  const optimal = optimalComplexityProjection(sql`${publication}.id`);
  const accepted = sql`COALESCE(${profiles}->(COALESCE(${policy},'efficient'))->'complexity',${profiles}->'efficient'->'complexity')`;
  return sql`jsonb_strip_nulls(jsonb_build_object(
    'optimal',${optimal},
    'accepted',CASE WHEN ${optimal} IS NOT NULL AND regexp_replace(${accepted}::text, '[[:space:]$]', '', 'g') IS DISTINCT FROM regexp_replace(${optimal}::text, '[[:space:]$]', '', 'g') THEN ${accepted} END
  ))`;
}
