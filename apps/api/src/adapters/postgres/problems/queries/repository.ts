/** @file repository.ts @description Explicit authorized PostgreSQL catalog projections. @module problems */
import { publicExampleJson } from "./public-projection.ts";
import { impressionIds, recordFeedback } from "../recommendations/feedback.ts";
import { rankPractice } from "../../../../modules/problems/recommendations/ranking.ts";
import { recommendationContext, learningQuestions } from "../recommendations/repository.ts";
import {
  canonicalApproachProjection,
  approachesProjection,
  complexityProjection,
} from "../editorial-storage.ts";
import type { FilterMatch } from "@quorem/contracts";
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
import {
  isTopic,
  primaryFoundationalTopic,
  restrictedTopicPublications,
  topicColumns,
  topicJoin,
  topicMatches,
  topicProjection,
  topicSearch,
} from "../topics.ts";
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
const projection = sql`jsonb_build_object(
'id',v.id,'isPrivate',p.owner_id IS NOT NULL,'slug',p.slug,'title',v.title,'difficulty',v.difficulty,
'sql',v.sql_config,'odyssey',CASE WHEN v.odyssey IS NOT NULL THEN jsonb_build_object('levels',jsonb_build_array(v.odyssey->'levels'->0)) ELSE NULL END,
'statementMarkdown',v.statement_markdown,'signature',COALESCE(v.signature,v.odyssey->'levels'->0->'methods'->0),'constraints',v.constraints,'limits',v.limits,
'hasSolutions',v.odyssey IS NULL AND EXISTS(SELECT 1 FROM problem_solution_approaches WHERE publication_id=v.id),
'hasComplexity',v.odyssey IS NULL AND (${complexityProjection(sql`v`)} ? 'optimal'),
'leetcodeId',p.leetcode_id,'companies',COALESCE((SELECT jsonb_agg(c.name ORDER BY c.name) FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id),'[]'::jsonb),
'tags',${topicProjection(sql`v.id`)},
'examples',COALESCE((SELECT jsonb_agg(${publicExampleJson} ORDER BY ordinal) FROM problem_examples WHERE publication_id=v.id),'[]'::jsonb))`;
const from = sql.raw(` FROM question_publications v JOIN problems p ON p.id=v.problem_id `);
const detailProjection = sql`(${projection} || jsonb_build_object(
  'hiddenCaseCounts', COALESCE((
    SELECT jsonb_object_agg(stage,n) FROM (
      SELECT stage,count(*) AS n FROM runner_publication_input_cases
      WHERE publication_id=v.id AND channel='hidden' GROUP BY stage
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
function catalogKind(f: CatalogFilter): SQL {
  return sql`(${f.type}='' OR (v.odyssey IS NOT NULL)=(${f.type}='odyssey'))
    AND (${f.sql}='' OR (v.sql_config IS NOT NULL)=(${f.sql}='true'))`;
}

/** Test each selected value independently so a topic's aliases count as one choice. */
function matchValues(values: string, mode: FilterMatch | undefined, matches: SQL): SQL {
  const selection = sql`SELECT 1 FROM unnest(string_to_array(${values},',')) AS selected(value)`;
  if (mode === "all") return sql`NOT EXISTS (${selection} WHERE NOT ${matches})`;
  const any = sql`EXISTS (${selection} WHERE ${matches})`;
  return mode === "not" ? sql`NOT ${any}` : any;
}

function catalogWhere(actor: ProblemActor | undefined, f: CatalogFilter): SQL {
  const topics = f.topic
    ? sql`AND ${matchValues(
        f.topic,
        f.topicMatch,
        sql`EXISTS (
          SELECT 1 FROM problem_tags t ${topicJoin}
          WHERE t.publication_id=v.id AND ${isTopic} AND ${topicMatches(sql`selected.value`)}
        )`,
      )}`
    : sql``;
  const companies = f.company
    ? sql`AND ${matchValues(
        f.company,
        f.companyMatch,
        sql`EXISTS (
          SELECT 1 FROM problem_companies pc JOIN companies c ON c.id=pc.company_id
          WHERE pc.problem_id=p.id AND c.name=selected.value
        )`,
      )}`
    : sql``;
  return sql`${catalogVisibility(actor, f.library)} AND ${catalogKind(f)} AND v.id=p.current_publication_id
    AND (${f.query}='' OR strpos(lower(v.title||' '||p.slug),lower(${f.query}))>0
      OR EXISTS(SELECT 1 FROM problem_tags t ${topicJoin} WHERE t.publication_id=v.id AND ${topicSearch(f.query)}))
    AND (${f.difficulty}='' OR v.difficulty=ANY(string_to_array(${f.difficulty},','))) ${topics} ${companies}`;
}
type Projected = {
  id: string;
  data: string;
  lossless: Uint8Array | null;
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
async function restrictedTopicIds(tx: Transaction, actor: ProblemActor | undefined) {
  if (!actor?.userId) return [];
  const restricted = (await tx.execute<{ id: string }>(restrictedTopicPublications(actor.userId)))
    .rows;
  return restricted.map(({ id }) => id);
}
function redactMatchTopics(restricted: string[], values: JsonValue[]) {
  const ids = new Set(restricted);
  for (const value of values) {
    const problem = object(value);
    if (typeof problem.id === "string" && ids.has(problem.id)) {
      problem.tags = [];
      delete problem.recommendationReason;
    }
  }
  return values;
}
const rank = sql.raw("CASE v.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END");
const rowProjection = sql`v.id::text AS id,${projection}::text AS data,v.lossless_public AS lossless`;
async function readCatalog(tx: Transaction, actor: ProblemActor | undefined, f: CatalogFilter) {
  const account = f.sort === "recommended" && actor && !actor.guestScope ? actor.userId : undefined;
  const where = sql`${catalogWhere(actor, f)}${
      account
        ? sql` AND NOT EXISTS(
    SELECT 1 FROM recommendation_impressions r WHERE r.owner_id=${account} AND r.publication_id=v.id
      AND r.dismissed_at>statement_timestamp()-interval '7 days')`
        : sql``
    }`,
    visibility = catalogVisibility(actor, f.library);
  const restricted = await restrictedTopicIds(tx, actor);
  const grouped = f.groupBy === "topic";
  const group = sql`CASE WHEN v.id <> ALL(${sql.param(restricted)}::uuid[])
    THEN ${primaryFoundationalTopic(sql`v.id`)} END`;
  const groupJoin = grouped ? sql`CROSS JOIN LATERAL (SELECT ${group} AS label) grouping` : sql``;
  const groupProjection = grouped ? sql`, grouping.label AS "groupLabel"` : sql``;
  const groupOrdering = grouped ? sql`grouping.label ASC NULLS LAST, ` : sql``;
  const groupFilter =
    grouped && f.topicGroup !== undefined
      ? sql`AND grouping.label IS NOT DISTINCT FROM ${f.topicGroup}::text`
      : sql``;
  const viewer = f.sort !== "recommended" && actor && !actor.guestScope ? actor.userId : undefined;
  const progress = viewer
    ? sql`(EXISTS (
    SELECT 1 FROM match_question_solves ms WHERE ms.owner_id=${viewer} AND ms.publication_id=v.id
  ) OR EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.owner_id=${viewer} AND w.publication_id=v.id AND w.kind='solo'
      AND CASE WHEN v.odyssey IS NULL THEN
        EXISTS (SELECT 1 FROM practice_target_progress p WHERE p.workspace_id=w.id)
        OR EXISTS (SELECT 1 FROM practice_solves s WHERE s.workspace_id=w.id)
      ELSE EXISTS (
        SELECT 1 FROM odyssey_progress o WHERE o.scope_id=w.id AND o.publication_id=v.id AND o.completed
      ) END
  ))`
    : sql``;
  const groupProgress = viewer ? sql`, count(*) FILTER (WHERE ${progress})::text AS solved` : sql``;
  const groups =
    grouped && f.topicGroup === undefined
      ? (
          await tx.execute<{ label: string | null; count: string; solved?: string }>(
            sql`SELECT grouping.label, count(*)::text AS count ${groupProgress} ${from} ${groupJoin}
          WHERE ${where} GROUP BY 1 ORDER BY label ASC NULLS LAST`,
          )
        ).rows
      : undefined;
  const total = groups
    ? groups.reduce((count, row) => count + BigInt(row.count), 0n)
    : BigInt(
        (
          await tx.execute<{ total: string }>(
            sql`SELECT count(*)::text AS total ${from} ${groupJoin} WHERE ${where} ${groupFilter}`,
          )
        ).rows[0].total,
      );
  const direction = sql.raw(f.order === "desc" ? "DESC" : "ASC");
  const ordering =
    f.sort === "difficulty"
      ? sql`${rank} ${direction}, lower(v.title) ${direction}, p.slug ${direction}`
      : sql`lower(v.title) ${direction}, p.slug ${direction}`;
  const requestedOffset = BigInt(f.page - 1) * BigInt(f.limit);
  const offset = (requestedOffset > total ? total : requestedOffset).toString();
  const context =
    f.sort === "recommended"
      ? await recommendationContext(tx, account ? [account] : [])
      : undefined;
  // Stable account assignment keeps repeated queries in the same experiment arm.
  const explore = account
    ? (new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode("recommendation-v2:" + account),
        ),
      )[0] &
        1) ===
      1
    : false;
  const recommendations = context
    ? await (async () => {
        const ids = (
          await tx.execute<{ id: string }>(
            sql`SELECT v.id::text AS id ${from} WHERE ${where} ORDER BY v.id`,
          )
        ).rows.map((row) => row.id);
        return rankPractice(
          await learningQuestions(tx, ids),
          context,
          Date.now(),
          f.limit,
          explore,
        );
      })()
    : undefined;
  const recommendedIds = recommendations?.slice(0, f.limit).map((item) => item.question.id);
  const progressProjection = viewer ? sql`, ${progress} AS solved` : sql``;
  const rows = (
    await tx.execute<Projected & { groupLabel?: string | null; solved?: boolean }>(
      recommendedIds
        ? sql`SELECT ${rowProjection} ${from} WHERE ${where} AND v.id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(recommendedIds)}::jsonb))`
        : sql`SELECT ${rowProjection}${groupProjection}${progressProjection} ${from} ${groupJoin} WHERE ${where} ${groupFilter} ORDER BY ${groupOrdering}${ordering} LIMIT ${f.limit} OFFSET ${offset}::bigint`,
    )
  ).rows;
  if (recommendedIds) {
    const positions = new Map(recommendedIds.map((id, index) => [id, index]));
    rows.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  }
  const topicRows = (
    await tx.execute<{
      tag: string;
      slug: string | null;
      is_foundational: boolean | null;
      aliases: string[];
    }>(
      sql`WITH visible_tags AS (
        SELECT DISTINCT t.tag FROM problem_tags t
        JOIN question_publications v ON v.id=t.publication_id
        JOIN problems p ON p.current_publication_id=v.id
        WHERE ${visibility} AND ${catalogKind(f)} AND ${isTopic}
      )
      SELECT ${topicColumns}, array_agg(t.tag ORDER BY t.tag) AS aliases
      FROM visible_tags t ${topicJoin} GROUP BY 1,2,3 ORDER BY 1`,
    )
  ).rows;
  const topics = topicRows.map(({ tag }) => tag);
  const foundationalTopics = topicRows.flatMap(({ tag, slug, is_foundational, aliases }) =>
    is_foundational ? [{ value: `foundational:${slug}`, label: tag, tags: aliases }] : [],
  );
  // Old topic URLs keep resolving to the canonical label after a topic moves out of Foundational.
  const topicAliases = Object.fromEntries(
    topicRows.flatMap(({ tag, slug, is_foundational, aliases }) =>
      slug && !is_foundational
        ? [`foundational:${slug}`, tag, ...aliases].map((alias) => [alias.toLowerCase(), tag])
        : [],
    ),
  );
  const companyFacets = (
    await tx.execute<{ name: string; tier: string; count: string }>(
      sql`SELECT c.name, COALESCE(ct.tier,'other') AS tier, count(*)::text AS count
          FROM companies c JOIN problem_companies pc ON pc.company_id=c.id
          JOIN problems p ON p.id=pc.problem_id JOIN question_publications v ON v.id=p.current_publication_id
          LEFT JOIN company_tiers ct ON ct.company_key=lower(c.name)
          WHERE ${visibility} AND ${catalogKind(f)}
          GROUP BY c.name, ct.tier ORDER BY lower(c.name), c.name`,
    )
  ).rows.map(({ name, tier, count }) => ({ name, tier, count: new JsonNumber(count) }));
  const n = Number(total);
  if (!Number.isSafeInteger(n)) throw new Error("catalog total exceeds safe range");
  const reasons = new Map(recommendations?.map((item) => [item.question.id, item.reason]));
  const result: { [key: string]: JsonValue } = {
    items: redactMatchTopics(
      restricted,
      rows.map((row) => {
        const value = object(projected(row));
        const reason = reasons.get(row.id);
        if (reason) value.recommendationReason = reason;
        return value;
      }),
    ),
    ...(groups && {
      topicGroupStats: groups.map(({ label, count, solved }) => ({
        label,
        total: new JsonNumber(count),
        ...(solved !== undefined && { solved: new JsonNumber(solved) }),
      })),
    }),
    ...(grouped && {
      topicGroups: Object.fromEntries(rows.map(({ id, groupLabel }) => [id, groupLabel ?? null])),
    }),
    ...(viewer && { solvedIds: rows.filter((row) => row.solved).map(({ id }) => id) }),
    total: new JsonNumber(String(n)),
    page: new JsonNumber(String(f.page)),
    limit: new JsonNumber(String(f.limit)),
    topics,
    foundationalTopics,
    topicAliases,
    companies: companyFacets.map(({ name }) => name),
    companyFacets,
  };
  return {
    result,
    account,
    ids: rows.map((row) => row.id),
    model: context?.modelId ?? null,
    explore,
  };
}
async function byValue(
  tx: Transaction,
  actor: ProblemActor | undefined,
  value: string,
  byId: boolean,
): Promise<string | null> {
  const select = byId
    ? sql`v.id::text=${value}`
    : sql`p.slug=${value} AND v.id=p.current_publication_id`;
  const rows = (
    await tx.execute<Projected>(
      sql`SELECT ${detailProjection} AS data,v.lossless_public AS lossless ${from} WHERE ${select} AND ${visible(actor, byId)} LIMIT 1`,
    )
  ).rows;
  return rows.length
    ? stringifyLosslessJson(
        redactMatchTopics(await restrictedTopicIds(tx, actor), [projected(rows[0])])[0],
      )
    : null;
}
/** Projects a publication after the caller has authorized its specific context. */
export async function projectAuthorizedPublication(
  tx: Transaction,
  id: string,
  actor?: ProblemActor,
): Promise<string | null> {
  const rows = (
    await tx.execute<Projected>(
      sql`SELECT ${detailProjection} AS data,v.lossless_public AS lossless ${from} WHERE v.id::text=${id} LIMIT 1`,
    )
  ).rows;
  return rows.length
    ? stringifyLosslessJson(
        redactMatchTopics(await restrictedTopicIds(tx, actor), [projected(rows[0])])[0],
      )
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
      matchAcceptance: string | null;
    }>(sql`SELECT
 (SELECT v.odyssey IS NOT NULL FROM question_publications v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${id} AND ${visible(actor, true)} LIMIT 1) AS staged,
 EXISTS(SELECT 1 FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE ${who}<>'' AND mp.owner_id=${who} AND m.publication_id::text=${id} AND m.state IN ('active','finalizing')) AS active,
 EXISTS(SELECT 1 FROM match_reservations r JOIN matches m ON m.id=r.match_id WHERE ${who}<>'' AND r.owner_id=${who} AND m.publication_id::text=${id} AND m.state IN ('active','finalizing') AND (m.rules->'assistance'->'complexity'->>'access'='free' OR EXISTS(SELECT 1 FROM match_participants mp JOIN match_rule_events e ON e.match_id=mp.match_id AND e.competitor_id=COALESCE(mp.competitor_id,mp.owner_id) WHERE mp.match_id=m.id AND mp.owner_id=${who} AND e.kind='complexity' AND e.resource_key='complexity'))) AS "allowComplexity",
 (SELECT COALESCE(m.rules->>'acceptance','efficient') FROM match_reservations r
   JOIN matches m ON m.id=r.match_id WHERE r.owner_id=${who} AND m.publication_id::text=${id}
   AND m.state IN ('active','finalizing') LIMIT 1) AS "matchAcceptance"`)
  ).rows;
  const state = rows[0];
  if (state.active && !(complexityOnly && state.allowComplexity))
    throw new ApplicationError("forbidden", "Editorial unavailable during an active match", 403);
  if (state.staged === null) throw new ApplicationError("not_found", "Problem not found", 404);
  if (state.staged) return complexityOnly ? "{}" : '{"canonicalApproachId":"","items":[]}';
  if (complexityOnly) {
    const { rows } = await tx.execute<{ value: string }>(
      sql`SELECT ${complexityProjection(sql`v`, sql`${state.matchAcceptance}::text`)}::text AS value FROM question_publications v WHERE v.id=${id}::uuid`,
    );
    return rows[0].value;
  }
  const row = (
    await tx.execute<{ value: string }>(
      sql`SELECT jsonb_build_object('canonicalApproachId',${canonicalApproachProjection(sql`${id}::uuid`)},'items',${approachesProjection(sql`${id}::uuid`)})::text AS value`,
    )
  ).rows[0];
  if (
    actor &&
    !actor.guestScope &&
    !complexityOnly &&
    !state.active &&
    JSON.parse(row.value).items.length
  ) {
    await tx.execute(sql`
      INSERT INTO question_exposure(owner_id,publication_id,last_seen_at,assisted_at)
      VALUES(${actor.userId},${id}::uuid,statement_timestamp(),statement_timestamp())
      ON CONFLICT(owner_id,publication_id) DO UPDATE SET assisted_at=EXCLUDED.assisted_at
    `);
  }
  return row.value;
}
/** Select only candidate identifiers under the caller's transaction. */
export async function readCandidates(
  tx: Transaction,
  actor: ProblemActor,
  criteria: CandidateCriteria,
) {
  const selection = sql`SELECT v.id::text AS id,v.sql_config IS NOT NULL AND v.sql_config <> 'null'::jsonb AS sql FROM question_publications v JOIN problems p ON p.id=v.problem_id`;
  if (criteria.selectedPublicationId)
    return (
      await tx.execute<{ id: string; sql: boolean }>(
        sql`${selection} WHERE v.id::text=${criteria.selectedPublicationId} AND (p.owner_id IS NULL OR (${actor.userId}<>'' AND p.owner_id=${actor.userId})) ORDER BY v.id`,
      )
    ).rows;
  const filter: CatalogFilter = {
    query: "",
    difficulty: criteria.difficulty,
    topic: criteria.topic,
    topicMatch: criteria.topicMatch,
    company: criteria.company,
    companyMatch: criteria.companyMatch,
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
  const write = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) =>
      scope.transaction({ ...options, readOnly: false, isolation: "read committed" }, f),
    );
  return {
    catalog: async (actor, filter) => {
      const page = await read((tx) => readCatalog(tx, actor, filter));
      const account = page.account;
      if (account && page.ids.length)
        page.result.recommendationImpressions = await write((tx) =>
          impressionIds(tx, account, page.ids, page.model, page.explore),
        );
      return stringifyLosslessJson(page.result);
    },
    recommendationFeedback: (owner, ids, action) =>
      write((tx) => recordFeedback(tx, owner, ids, action)),
    bySlug: (actor, slug) => read((tx) => byValue(tx, actor, slug, false)),
    byPublication: (actor, id) => read((tx) => byValue(tx, actor, id, true)),
    editorials: (actor, id, complexity) =>
      (actor && !actor.guestScope && !complexity ? write : read)((tx) =>
        readEditorials(tx, actor, id, complexity),
      ),
    candidates: (actor, criteria) => read((tx) => readCandidates(tx, actor, criteria)),
  };
}
