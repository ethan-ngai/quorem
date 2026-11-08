/** @file queries.ts @description Transaction-bound authoring lists and facets. @module problems */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  AuthorActor,
  AuthoringFilters,
  QuestionAuthoring,
} from "../../../../modules/problems/authoring/ports.ts";

/** Match catalog metadata before sorting and pagination. */
function matchesAuthoringFilters(filters?: AuthoringFilters): SQL {
  const {
    query = "",
    sql: language = "",
    type = "",
    difficulty = "",
    topic = "",
    topicMatch,
    company = "",
    companyMatch,
    source = "",
  } = filters ?? {};
  return sql`
    (${query}='' OR strpos(lower(title||' '||slug),lower(${query}))>0)
    AND (${language}='' OR "isSql"=(${language}='true'))
    AND (${type}='' OR "isOdyssey"=(${type}='odyssey'))
    AND (${difficulty}='' OR difficulty=ANY(string_to_array(${difficulty},',')))
    AND (${topic}='' OR tags ${topicMatch === "all" ? sql`@>` : sql`&&`} string_to_array(${topic},','))
    AND (${company}='' OR companies ${companyMatch === "all" ? sql`@>` : sql`&&`} string_to_array(${company},','))
    AND (${source}='' OR "fromLeetCode"=(${source}='leetcode'))
  `;
}

type DraftListRow = {
  id: string;
  revision: string;
  title: string;
  slug: string;
  editVersionId: string | null;
  updated_at: Date;
  updatedAt: string;
  raw: string;
  fromLeetCode: boolean;
  isSql: boolean;
  isOdyssey: boolean;
  difficulty: string;
  tags: string[];
  companies: string[];
};

function authoringOrder(filters?: AuthoringFilters, drafts = false) {
  const sort = filters?.sort ?? (drafts ? "updatedAt" : "title");
  const descending = (filters?.order ?? (drafts ? "desc" : "asc")) === "desc";
  const direction = descending ? sql`DESC` : sql`ASC`;
  const key =
    sort === "difficulty"
      ? sql`CASE difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`
      : sort === "updatedAt"
        ? sql`updated_at`
        : sql`lower(title)`;
  return {
    key,
    order: sql`${key} ${direction},id ${direction}`,
    after: descending ? sql`<` : sql`>`,
  };
}

async function authoringFacets(tx: Transaction, catalog: SQL) {
  const [facets] = (
    await tx.execute<{ topics: string[]; companies: string[] }>(sql`
    WITH metadata AS (SELECT tags,companies FROM (${catalog}) catalog)
    SELECT ARRAY(SELECT DISTINCT unnest(tags) FROM metadata ORDER BY 1) AS topics,
           ARRAY(SELECT DISTINCT unnest(companies) FROM metadata ORDER BY 1) AS companies
  `)
  ).rows;
  return facets;
}

type Transact = <T>(action: (tx: Transaction) => Promise<T>, readOnly?: boolean) => Promise<T>;

export function authoringQueries(
  transact: Transact,
  author: (tx: Transaction, actor: AuthorActor, lock: boolean) => Promise<{ admin: boolean }>,
  preparePublication: (raw: string) => void,
): Pick<QuestionAuthoring, "publications" | "list"> {
  return {
    async publications(actor, filters) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        const catalog = sql`
          SELECT chosen.id::text,chosen.title,p.slug,chosen.version::text,
                 chosen.difficulty,
                 COALESCE(jsonb_typeof(chosen.odyssey)='object',false) AS "isOdyssey",
                 ARRAY(SELECT tag FROM problem_tags WHERE version_id=chosen.id ORDER BY ordinal) AS tags,
                 ARRAY(SELECT c.name FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id ORDER BY c.name) AS companies,
                 p.owner_id IS NOT NULL AS "isPrivate",
                 p.leetcode_id IS NOT NULL AS "fromLeetCode",
                 COALESCE(jsonb_typeof(chosen.sql_config)='object',false) AS "isSql",
                 COALESCE(chosen.id=p.current_version_id,false) AS current
          FROM problems p
          CROSS JOIN LATERAL (
            SELECT v.id,v.title,v.version,v.sql_config,v.difficulty,v.odyssey FROM problem_versions v WHERE v.problem_id=p.id AND v.sealed
            ORDER BY (v.id IS NOT DISTINCT FROM p.current_version_id) DESC,v.version DESC LIMIT 1
          ) chosen
          WHERE p.owner_id=${actor.userId} OR (p.owner_id IS NULL AND ${admin})
        `;
        const { page = 1, limit = 50 } = filters ?? {};
        const where = matchesAuthoringFilters(filters);
        const { order } = authoringOrder(filters);
        const result = await tx.execute(
          sql`SELECT * FROM (${catalog}) catalog WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        );
        const count = await tx.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total FROM (${catalog}) catalog WHERE ${where}`,
        );
        const facets = await authoringFacets(tx, catalog);
        return JSON.stringify({
          items: result.rows,
          total: count.rows[0].total,
          page,
          limit,
          facets,
        });
      }, true);
    },
    async list(actor, filters) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        const catalog = sql`SELECT id::text AS id,revision::text AS revision,updated_at,
                COALESCE(content->'problem'->>'difficulty','easy') AS difficulty,
                COALESCE(jsonb_typeof(content->'problem'->'odyssey')='object',false) AS "isOdyssey",
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(content->'problem'->'tags','[]'::jsonb))) AS tags,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(content->'problem'->'companies','[]'::jsonb))) AS companies,
                COALESCE(convert_from(lossless_content,'UTF8'),content::text) AS raw,
                COALESCE(jsonb_typeof(content->'problem'->'leetcodeId')='number',false) AS "fromLeetCode",
                COALESCE(jsonb_typeof(content->'problem'->'sql')='object',false) AS "isSql",COALESCE(content->'problem'->>'title','') AS title,COALESCE(content->'problem'->>'slug','') AS slug,edit_version_id::text AS "editVersionId",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
                FROM question_drafts WHERE published_version_id IS NULL AND (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin}))`;
        const { page = 1, limit = 50 } = filters ?? {};
        const where = matchesAuthoringFilters(filters);
        const { key, order, after } = authoringOrder(filters, true);
        const facets = await authoringFacets(tx, catalog);
        const offset = (page - 1) * limit;
        const summarize = (row: DraftListRow) => {
          const { raw, editVersionId, updated_at: _updatedAt, ...summary } = row;
          let ready = true;
          try {
            preparePublication(raw);
          } catch (error) {
            if (!(error instanceof ApplicationError)) throw error;
            ready = false;
          }
          return { ...summary, ready, ...(editVersionId ? { editVersionId } : {}) };
        };
        if (!filters?.readiness) {
          const rows = await tx.execute<DraftListRow>(
            sql`SELECT * FROM (${catalog}) catalog WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
          );
          const count = await tx.execute<{ total: number }>(
            sql`SELECT count(*)::int AS total FROM (${catalog}) catalog WHERE ${where}`,
          );
          return JSON.stringify({
            items: rows.rows.map(summarize),
            total: count.rows[0].total,
            page,
            limit,
            facets,
          });
        }
        // Readiness uses the publication validator; scan bounded batches before pagination.
        const items = [];
        let total = 0;
        let cursor: string | undefined;
        for (;;) {
          // Resolve the cursor in PostgreSQL so timestamp precision is preserved.
          const following = cursor
            ? sql`AND (${key},id) ${after} (SELECT ${key},id FROM (${catalog}) marker WHERE id=${cursor})`
            : sql``;
          const rows = await tx.execute<DraftListRow>(
            sql`SELECT * FROM (${catalog}) catalog WHERE ${where} ${following} ORDER BY ${order} LIMIT 50`,
          );
          for (const row of rows.rows) {
            const summary = summarize(row);
            if (summary.ready !== (filters.readiness === "ready")) continue;
            if (total >= offset && items.length < limit) items.push(summary);
            total++;
          }
          if (rows.rows.length < 50) break;
          cursor = rows.rows[rows.rows.length - 1].id;
        }
        return JSON.stringify({ items, total, page, limit, facets });
      }, true);
    },
  };
}
