import { canonicalApproachProjection, approachesProjection } from "../editorial-storage.ts";
/** @file repository.ts @description Explicit authorized PostgreSQL catalog projections. @module problems */
import { sql, type SQL } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import {
  jsonObject as object,
  restorePublicExamples,
  visibleProblem as visible,
} from "./public-projection.ts";
import { projectQuestionRuntime } from "../runtime.ts";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  CandidateCriteria,
  CatalogFilter,
  ProblemActor,
} from "../../../../modules/problems/model.ts";
import type { ProblemQueries } from "../../../../modules/problems/ports.ts";

export type ReadScope = <T>(
  read: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>,
) => Promise<T>;
const options = {
  readOnly: true,
  isolation: "repeatable read" as const,
  statementTimeoutMs: 3000,
  lockTimeoutMs: 1000,
};
const projection = sql.raw(`jsonb_build_object(
'id',v.id,'isPrivate',p.owner_id IS NOT NULL,'slug',p.slug,'version',v.version::text,'title',v.title,'difficulty',v.difficulty,
'sql',v.sql_config,'odyssey',CASE WHEN v.odyssey IS NOT NULL THEN jsonb_build_object('levels',jsonb_build_array(v.odyssey->'levels'->0)) ELSE NULL END,
'statementMarkdown',v.statement_markdown,'signature',COALESCE(v.signature,v.odyssey->'levels'->0->'methods'->0),'constraints',v.constraints,'limits',v.limits,
'hasSolutions',v.odyssey IS NULL AND EXISTS(SELECT 1 FROM problem_solution_approaches WHERE version_id=v.id),
'hasComplexity',v.odyssey IS NULL AND EXISTS(SELECT 1 FROM problem_solution_approaches WHERE version_id=v.id AND btrim(time_complexity)<>'' AND btrim(space_complexity)<>''),
'leetcodeId',p.leetcode_id,'companies',COALESCE((SELECT jsonb_agg(c.name ORDER BY c.name) FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id),'[]'::jsonb),
'tags',COALESCE((SELECT jsonb_agg(tag ORDER BY ordinal) FROM problem_tags WHERE version_id=v.id),'[]'::jsonb),
'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation,'calls',calls) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'::jsonb))`);
const from = sql.raw(` FROM problem_versions v JOIN problems p ON p.id=v.problem_id `);
const detailProjection = sql`(${projection} || jsonb_build_object(
  'hiddenCaseCounts', COALESCE((
    SELECT jsonb_object_agg(stage,n) FROM (
      SELECT stage,count(*) AS n FROM runner_version_input_cases
      WHERE version_id=v.id AND channel='hidden' GROUP BY stage
    ) counts
  ), '{}'::jsonb)
))::text`;
function owner(actor: ProblemActor | undefined): string {
  return actor?.userId ?? "";
}
function catalogVisibility(
  actor: ProblemActor | undefined,
  library: CatalogFilter["library"],
): SQL {
  const who = owner(actor);
  return sql`(p.owner_id IS NULL OR (${who}<>'' AND p.owner_id=${who})) AND (${library}='' OR (${library}='global' AND p.owner_id IS NULL) OR (${library}='private' AND (${who}<>'' AND p.owner_id=${who})))`;
}
// Match imported spelling variants without rewriting published tags.
const tagKey = sql`trim(both '-' from regexp_replace(lower(t.tag), '[^a-z0-9]+', '-', 'g'))`;
const foundationalMatch = sql`(${tagKey}=ft.slug OR ${tagKey}=ANY(ft.aliases))`;
const foundationalFilter = sql`'foundational:' || ft.slug`;

function catalogWhere(actor: ProblemActor | undefined, f: CatalogFilter): SQL {
  const topics = f.topic
    ? sql`AND EXISTS (
        SELECT 1 FROM problem_tags t WHERE t.version_id=v.id AND (
          t.tag=ANY(string_to_array(${f.topic},',')) OR EXISTS (
            SELECT 1 FROM foundational_topics ft
            WHERE ${foundationalFilter}=ANY(string_to_array(${f.topic},',')) AND ${foundationalMatch}
          )
        )
      )`
    : sql``;
  return sql`${catalogVisibility(actor, f.library)} AND (${f.type}='' OR (${f.type}='odyssey' AND v.odyssey IS NOT NULL) OR (${f.type}='classic' AND v.odyssey IS NULL)) AND (${f.sql}='' OR (${f.sql}='true' AND v.sql_config IS NOT NULL) OR (${f.sql}='false' AND v.sql_config IS NULL)) AND v.id=p.current_version_id AND (${f.query}='' OR strpos(lower(v.title||' '||p.slug),lower(${f.query}))>0 OR EXISTS(SELECT 1 FROM problem_tags t WHERE t.version_id=v.id AND strpos(lower(t.tag),lower(${f.query}))>0)) AND (${f.difficulty}='' OR v.difficulty=ANY(string_to_array(${f.difficulty},','))) ${topics} AND (${f.company}='' OR EXISTS(SELECT 1 FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id AND c.name=ANY(string_to_array(${f.company},','))))`;
}
type Projected = {
  data: string;
  lossless: Uint8Array | null;
  sortTitle: string;
  slug: string;
  rank: number;
};
function projected(row: Projected): JsonValue {
  const value = object(parseLosslessJson(row.data));
  restorePublicExamples(value, row.lossless);
  if (Array.isArray(value.constraints))
    value.constraints = value.constraints.map((rule) =>
      typeof rule === "string" ? { kind: "prose", text: rule } : rule,
    );
  for (const key of ["sql", "odyssey", "leetcodeId"]) if (value[key] === null) delete value[key];
  if (value.isPrivate === false) delete value.isPrivate;
  if (value.sql) delete value.signature;
  projectQuestionRuntime(value);
  return value;
}
async function redactMatchTopics(
  tx: Transaction,
  actor: ProblemActor | undefined,
  values: JsonValue[],
) {
  if (!actor?.userId) return values;
  const restricted = (
    await tx.execute<{ id: string }>(
      sql`SELECT m.problem_version_id::text AS id FROM matches m JOIN match_participants p ON p.match_id=m.id AND p.owner_id=${actor.userId} WHERE m.state IN ('active','finalizing') AND m.rules->'assistance'->'topics'->>'access'<>'free' AND NOT EXISTS(SELECT 1 FROM match_rule_events e WHERE e.match_id=m.id AND e.competitor_id=COALESCE(p.competitor_id,p.owner_id) AND e.kind='topics' AND e.resource_key='topics')`,
    )
  ).rows;
  const ids = new Set(restricted.map((r) => r.id));
  for (const value of values) {
    const problem = object(value);
    if (typeof problem.id === "string" && ids.has(problem.id)) problem.tags = [];
  }
  return values;
}
type Cursor = { title: string; slug: string; rank: number; filter: string };
function filterKey(f: CatalogFilter): string {
  return JSON.stringify([
    f.query,
    f.difficulty,
    f.topic,
    f.company,
    f.sort,
    f.order,
    f.library,
    f.type,
    f.sql,
  ]);
}
function encodeCursor(c: Cursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(c))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decodeCursor(raw: string, f: CatalogFilter): Cursor {
  try {
    const text = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    const c = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(text, (x) => x.charCodeAt(0)),
      ),
    ) as Cursor;
    if (
      typeof c.title !== "string" ||
      typeof c.slug !== "string" ||
      !Number.isInteger(c.rank) ||
      c.rank < 0 ||
      c.rank > 2 ||
      c.filter !== filterKey(f)
    )
      throw new Error();
    return c;
  } catch {
    throw new ApplicationError("invalid_input", "Invalid question filters", 400);
  }
}
const rank = sql.raw("CASE v.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END");
async function readCatalog(
  tx: Transaction,
  actor: ProblemActor | undefined,
  f: CatalogFilter,
): Promise<string> {
  const where = catalogWhere(actor, f),
    visibility = catalogVisibility(actor, f.library),
    cursor = f.cursor ? decodeCursor(f.cursor, f) : undefined;
  const [{ total }] = (
    await tx.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE ${where}`,
    )
  ).rows;
  const direction = sql.raw(f.order === "desc" ? "DESC" : "ASC");
  const ordering =
    f.sort === "difficulty"
      ? sql`${rank} ${direction}, lower(v.title) ${direction}, p.slug ${direction}`
      : sql`lower(v.title) ${direction}, p.slug ${direction}`;
  const comparator = sql.raw(f.order === "asc" ? ">" : "<");
  const after = cursor
    ? f.sort === "difficulty"
      ? sql`AND (${rank},lower(v.title),p.slug) ${comparator} (${cursor.rank},${cursor.title},${cursor.slug})`
      : sql`AND (lower(v.title),p.slug) ${comparator} (${cursor.title},${cursor.slug})`
    : sql``;
  const offset = cursor ? 0 : (f.page - 1) * f.limit;
  const rows = (
    await tx.execute<Projected>(
      sql`SELECT ${projection}::text AS data,v.lossless_public AS lossless,lower(v.title) AS "sortTitle",p.slug AS slug,${rank} AS rank ${from} WHERE ${where} ${after} ORDER BY ${ordering} LIMIT ${f.limit + 1} OFFSET ${offset}`,
    )
  ).rows;
  const more = rows.length > f.limit,
    items = rows.slice(0, f.limit);
  const last = items.at(-1);
  const topicRows = (
    await tx.execute<{ tag: string; value: string | null; label: string | null }>(
      sql`WITH visible_tags AS (
        SELECT DISTINCT t.tag FROM problem_tags t
        JOIN problems p ON p.current_version_id=t.version_id WHERE ${visibility}
      )
      SELECT t.tag,${foundationalFilter} AS value,ft.label FROM visible_tags t
      LEFT JOIN foundational_topics ft ON ${foundationalMatch} ORDER BY t.tag`,
    )
  ).rows;
  const topics = [...new Set(topicRows.map((row) => row.tag))];
  const foundationalTopics = new Map<string, { value: string; label: string; tags: string[] }>();
  for (const { tag, value, label } of topicRows) {
    if (value === null || label === null) continue;
    const topic = foundationalTopics.get(value);
    if (topic) topic.tags.push(tag);
    else foundationalTopics.set(value, { value, label, tags: [tag] });
  }
  const companies = (
    await tx.execute<{ name: string }>(
      sql`SELECT DISTINCT c.name FROM companies c JOIN problem_companies pc ON pc.company_id=c.id JOIN problems p ON p.id=pc.problem_id WHERE p.current_version_id IS NOT NULL AND ${visibility} ORDER BY c.name`,
    )
  ).rows.map((r) => r.name);
  const n = Number(total);
  if (!Number.isSafeInteger(n)) throw new Error("catalog total exceeds safe range");
  const result: { [key: string]: JsonValue } = {
    items: await redactMatchTopics(tx, actor, items.map(projected)),
    total: new JsonNumber(String(n)),
    page: new JsonNumber(String(f.page)),
    limit: new JsonNumber(String(f.limit)),
    topics,
    foundationalTopics: [...foundationalTopics.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    companies,
  };
  if (more && last)
    result.nextCursor = encodeCursor({
      title: last.sortTitle,
      slug: last.slug,
      rank: last.rank,
      filter: filterKey(f),
    });
  return stringifyLosslessJson(result);
}
async function byValue(
  tx: Transaction,
  actor: ProblemActor | undefined,
  value: string,
  version: boolean,
): Promise<string | null> {
  const select = version
    ? sql`v.id::text=${value}`
    : sql`p.slug=${value} AND v.id=p.current_version_id`;
  const rows = (
    await tx.execute<Projected>(
      sql`SELECT ${detailProjection} AS data,v.lossless_public AS lossless,lower(v.title) AS "sortTitle",p.slug AS slug,${rank} AS rank ${from} WHERE ${select} AND ${visible(actor, version)} LIMIT 1`,
    )
  ).rows;
  return rows.length
    ? stringifyLosslessJson((await redactMatchTopics(tx, actor, [projected(rows[0])]))[0])
    : null;
}
/** Projects a version after the caller has authorized its specific context. */
export async function projectAuthorizedVersion(
  tx: Transaction,
  id: string,
  actor?: ProblemActor,
): Promise<string | null> {
  const rows = (
    await tx.execute<Projected>(
      sql`SELECT ${detailProjection} AS data,v.lossless_public AS lossless,lower(v.title) AS "sortTitle",p.slug AS slug,${rank} AS rank ${from} WHERE v.id::text=${id} LIMIT 1`,
    )
  ).rows;
  return rows.length
    ? stringifyLosslessJson((await redactMatchTopics(tx, actor, [projected(rows[0])]))[0])
    : null;
}
async function readEditorials(
  tx: Transaction,
  actor: ProblemActor | undefined,
  id: string,
  complexityOnly: boolean,
): Promise<string> {
  const who = owner(actor);
  const rows = (
    await tx.execute<{
      staged: boolean | null;
      active: boolean;
      allowComplexity: boolean;
    }>(sql`SELECT
 (SELECT v.odyssey IS NOT NULL FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${id} AND ${visible(actor, true)} LIMIT 1) AS staged,
 EXISTS(SELECT 1 FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE ${who}<>'' AND mp.owner_id=${who} AND m.problem_version_id::text=${id} AND m.state IN ('active','finalizing')) AS active,
 EXISTS(SELECT 1 FROM match_reservations r JOIN matches m ON m.id=r.match_id WHERE ${who}<>'' AND r.owner_id=${who} AND m.problem_version_id::text=${id} AND m.state IN ('active','finalizing') AND (m.rules->'assistance'->'complexity'->>'access'='free' OR EXISTS(SELECT 1 FROM match_participants mp JOIN match_rule_events e ON e.match_id=mp.match_id AND e.competitor_id=COALESCE(mp.competitor_id,mp.owner_id) WHERE mp.match_id=m.id AND mp.owner_id=${who} AND e.kind='complexity' AND e.resource_key='complexity'))) AS "allowComplexity"`)
  ).rows;
  const state = rows[0];
  if (state.active && !(complexityOnly && state.allowComplexity))
    throw new ApplicationError("forbidden", "Editorial unavailable during an active match", 403);
  if (state.staged === null) throw new ApplicationError("not_found", "Problem not found", 404);
  if (state.staged) return '{"canonicalApproachId":"","items":[]}';
  const row = (
    await tx.execute<{ value: string }>(
      sql`SELECT jsonb_build_object('canonicalApproachId',${canonicalApproachProjection(sql`${id}::uuid`)},'items',${approachesProjection(sql`${id}::uuid`, !complexityOnly)})::text AS value`,
    )
  ).rows[0];
  return row.value;
}
/** Select only candidate identifiers under the caller's transaction. */
export async function readCandidates(
  tx: Transaction,
  actor: ProblemActor,
  criteria: CandidateCriteria,
) {
  const selection = sql`SELECT v.id::text AS id,v.sql_config IS NOT NULL AND v.sql_config <> 'null'::jsonb AS sql FROM problem_versions v JOIN problems p ON p.id=v.problem_id`;
  if (criteria.selectedVersionId)
    return (
      await tx.execute<{ id: string; sql: boolean }>(
        sql`${selection} WHERE v.id::text=${criteria.selectedVersionId} AND (p.owner_id IS NULL OR (${actor.userId}<>'' AND p.owner_id=${actor.userId})) ORDER BY v.id`,
      )
    ).rows;
  const filter: CatalogFilter = {
    query: "",
    difficulty: criteria.difficulty,
    topic: criteria.topic,
    company: criteria.company,
    sort: "title",
    order: "asc",
    library: "",
    type: criteria.type,
    sql: criteria.sql,
    page: 1,
    limit: 100,
  };
  return (
    await tx.execute<{ id: string; sql: boolean }>(
      sql`${selection} WHERE ${catalogWhere(actor, filter)} ORDER BY v.id`,
    )
  ).rows;
}
/** Every operation uses a short, read-only snapshot owned by its caller. */
export function problemQueries(run: ReadScope): ProblemQueries {
  const read = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, f));
  return {
    catalog: (actor, filter) => read((tx) => readCatalog(tx, actor, filter)),
    bySlug: (actor, slug) => read((tx) => byValue(tx, actor, slug, false)),
    byVersion: (actor, id) => read((tx) => byValue(tx, actor, id, true)),
    editorials: (actor, id, complexity) => read((tx) => readEditorials(tx, actor, id, complexity)),
    candidates: (actor, criteria) => read((tx) => readCandidates(tx, actor, criteria)),
  };
}
