/** @file topics.ts @description Canonical display and filter topics over stored publication tags. @module problems */
import { sql, type SQL } from "drizzle-orm";

const fold = (tag: SQL) => sql`lower(btrim(regexp_replace(${tag}, '[[:space:]]+', ' ', 'g')))`;
const key = (tag: SQL) =>
  sql`trim(both '-' from regexp_replace(lower(${tag}), '[^a-z0-9]+', '-', 'g'))`;
const matches = (tag: SQL) => sql`(${key(tag)}=ft.slug OR ${key(tag)}=ANY(ft.aliases))`;

const rawTag = sql`t.tag`;
const normalizedTag = fold(rawTag);
const topicLabel = sql`COALESCE(ft.label,${normalizedTag})`;
export const topicJoin = sql`LEFT JOIN foundational_topics ft ON ${matches(rawTag)}`;
export const topicColumns = sql`${topicLabel} AS tag, ft.slug, ft.is_foundational`;
export const isTopic = sql`${normalizedTag} NOT IN ('','sql')`;

/** Canonicalize on read so sealed publication inputs and learning history stay intact. */
function questionTopics(version: SQL) {
  return sql`SELECT ${topicLabel} AS tag
    FROM problem_tags t ${topicJoin}
    WHERE t.version_id=${version} AND ${isTopic}
    GROUP BY 1
    ORDER BY bool_or(COALESCE(ft.is_foundational, false)) DESC, min(t.ordinal), 1`;
}

export function topicProjection(version: SQL) {
  return sql`to_jsonb(ARRAY(${questionTopics(version)}))`;
}

export function topicMatches(selection: SQL) {
  return sql`(${normalizedTag}=${fold(selection)} OR 'foundational:' || ft.slug=${selection}
    OR ${matches(selection)})`;
}

export function topicSearch(query: string) {
  return sql`(strpos(${normalizedTag},lower(${query}))>0
    OR strpos(lower(ft.label),lower(${query}))>0 OR ${matches(sql`${query}`)})`;
}
