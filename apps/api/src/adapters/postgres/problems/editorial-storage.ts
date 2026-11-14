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

function rankedComplexity(publication: SQL, end: "first" | "last"): SQL {
  const order = end === "first" ? sql`ASC` : sql`DESC`;
  // Authored order captures tradeoffs that cannot be inferred from Big O strings.
  return sql`(SELECT jsonb_build_object('timeComplexity',time_complexity,'spaceComplexity',space_complexity)
    FROM problem_solution_approaches
    WHERE publication_id=${publication}
      AND btrim(time_complexity) ~ '^[$]?(O|Θ)[[:space:]]*[(][^$[:cntrl:]]+[)][$]?$'
      AND btrim(space_complexity) ~ '^[$]?(O|Θ)[[:space:]]*[(][^$[:cntrl:]]+[)][$]?$'
    ORDER BY ordinal ${order} LIMIT 1)`;
}

/** Expose bounds without revealing approaches or code. */
export function complexityProjection(publication: SQL): SQL {
  const id = sql`${publication}.id`;
  return sql`(SELECT jsonb_strip_nulls(jsonb_build_object(
    'optimal',optimal,
    'accepted',CASE WHEN regexp_replace(accepted::text, '[[:space:]$]', '', 'g') IS DISTINCT FROM regexp_replace(optimal::text, '[[:space:]$]', '', 'g') THEN accepted END
  )) FROM (SELECT ${rankedComplexity(id, "first")} AS optimal,
                  ${rankedComplexity(id, "last")} AS accepted) bounds)`;
}
