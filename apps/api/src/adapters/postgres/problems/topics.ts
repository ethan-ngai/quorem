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
function questionTopics(publication: SQL, foundationalOnly = false) {
  return sql`SELECT ${topicLabel} AS tag
    FROM problem_tags t ${topicJoin}
    WHERE t.publication_id=${publication} AND ${isTopic}
      ${foundationalOnly ? sql`AND ft.is_foundational` : sql``}
    GROUP BY 1
    ORDER BY bool_or(COALESCE(ft.is_foundational, false)) DESC, min(t.ordinal), 1`;
}

export function primaryFoundationalTopic(publication: SQL) {
  return sql`(${questionTopics(publication, true)} LIMIT 1)`;
}

/** Match assistance applies to every surface that displays publication topics. */
export function restrictedTopicPublications(owner: string) {
  return sql`SELECT m.publication_id::text AS id FROM matches m JOIN match_participants p ON p.match_id=m.id AND p.owner_id=${owner} WHERE m.state IN ('active','finalizing') AND m.rules->'assistance'->'topics'->>'access'<>'free' AND NOT EXISTS(SELECT 1 FROM match_rule_events e WHERE e.match_id=m.id AND e.competitor_id=COALESCE(p.competitor_id,p.owner_id) AND e.kind='topics' AND e.resource_key='topics')`;
}

export function topicProjection(publication: SQL) {
  return sql`to_jsonb(ARRAY(${questionTopics(publication)}))`;
}

export function topicMatches(selection: SQL) {
  return sql`(${normalizedTag}=${fold(selection)} OR 'foundational:' || ft.slug=${selection}
    OR ${matches(selection)})`;
}

export function topicSearch(query: string) {
  return sql`(strpos(${normalizedTag},lower(${query}))>0
    OR strpos(lower(ft.label),lower(${query}))>0 OR ${matches(sql`${query}`)})`;
}
