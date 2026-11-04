/** @file repository.ts @description Atomic question drafts and immutable publication. @module problems */
import { sql } from "drizzle-orm";
import {
  classifyDatabaseError,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import {
  normalizeQuestionDraft,
  parseLosslessJson,
  stringifyLosslessJson,
  generateStarter,
  validateQuestionPublication,
  validateQuestionSchema,
  type JsonValue,
  type RuntimeResolver,
  type Signature,
  type StarterLanguage,
} from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  AuthorActor,
  QuestionAuthoring,
} from "../../../../modules/problems/authoring/ports.ts";
import { object, storageProjection } from "../storage.ts";
import { persistQuestionVersion, updateQuestionCatalogMetadata } from "../publication.ts";
import { readAuthoringQuestion } from "../private-content.ts";
import { preserveCaseLiterals } from "../case-literals.ts";
import {
  assertPublicationIdle,
  detachPublication,
  lockPublication,
  publicationImpact,
  removePublicationRow,
} from "./mutation.ts";

type Obj = { [key: string]: JsonValue };
export type AuthoringScope = <T>(action: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const opts = { statementTimeoutMs: 5000, lockTimeoutMs: 2000 };
const bad = (message: string) => new ApplicationError("invalid_input", message, 400);
const missing = () => new ApplicationError("not_found", "Question draft not found", 404);
const conflict = () =>
  new ApplicationError("revision_conflict", "Draft changed or already published; reload it", 409);
const forbidden = () => new ApplicationError("forbidden", "Custom question access required", 403);
function revision(value: string): void {
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw bad("Invalid draft revision");
}
function normal(raw: string): string {
  try {
    return normalizeQuestionDraft(raw);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : "Invalid question content");
  }
}
function store(raw: string) {
  try {
    return storageProjection(raw);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : "Invalid question content");
  }
}
function list(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
function str(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw bad("Invalid question content");
  return value;
}
function content(raw: string): Obj {
  return object(parseLosslessJson(raw));
}
async function author(
  tx: Transaction,
  actor: AuthorActor,
  lock: boolean,
): Promise<{ admin: boolean }> {
  const rows = (
    await tx.execute<{ admin: boolean }>(
      sql`SELECT u.role='admin' AS admin FROM users u WHERE u.id=${actor.userId} AND u.kind='account' AND NOT u.disabled ${lock ? sql`FOR SHARE` : sql``}`,
    )
  ).rows;
  if (!rows.length) throw forbidden();
  if (!rows[0].admin) {
    const grants = (
      await tx.execute<{ feature: string }>(
        sql`SELECT feature FROM entitlement_grants WHERE user_id=${actor.userId} AND feature IN ('internal','questions.custom') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) ${lock ? sql`FOR SHARE` : sql``}`,
      )
    ).rows;
    if (!grants.length) throw forbidden();
  }
  return rows[0];
}
type DraftRow = {
  id: string;
  revision: string;
  content: string;
  publishedVersionId: string | null;
  editVersionId: string | null;
  editBase: string | null;
  updatedAt: string;
  ownerId: string | null;
};
const draftColumns = sql.raw(
  `id::text AS id,revision::text AS revision,convert_from(COALESCE(lossless_content,convert_to(content::text,'UTF8')),'UTF8') AS content,published_version_id::text AS "publishedVersionId",edit_version_id::text AS "editVersionId",edit_base AS "editBase",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",owner_id AS "ownerId"`,
);
function draftJson(row: DraftRow): string {
  const d: Obj = {
    id: row.id,
    revision: row.revision,
    content: parseLosslessJson(row.content),
    updatedAt: row.updatedAt,
  };
  if (row.publishedVersionId) d.publishedVersionId = row.publishedVersionId;
  if (row.editVersionId) d.editVersionId = row.editVersionId;
  return stringifyLosslessJson(d);
}
async function readDraft(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  id: string,
  lock = false,
): Promise<DraftRow> {
  const rows = (
    await tx.execute<DraftRow>(
      sql`SELECT ${draftColumns} FROM question_drafts WHERE id::text=${id} AND (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin})) ${lock ? sql`FOR UPDATE` : sql``}`,
    )
  ).rows;
  if (!rows.length) throw missing();
  return rows[0];
}
async function create(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  raw: string,
  digest?: string,
  edit?: { id: string; token: string },
): Promise<string> {
  const data = store(normal(raw));
  const rows = (
    await tx.execute<DraftRow>(
      sql`INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,owner_id,import_digest,edit_version_id,edit_base) VALUES(${data.safe}::jsonb,${data.lossless},${actor.userId},${actor.userId},${admin ? null : actor.userId},${digest ?? null},${edit?.id ?? null}::uuid,${edit?.token ?? null}) RETURNING ${draftColumns}`,
    )
  ).rows;
  return draftJson(rows[0]);
}
async function contentDigest(text: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function lockIdentity(tx: Transaction, slug: string, leetcode: string | null) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${slug},740071))`);
  if (leetcode !== null)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${leetcode},740072))`);
}
function sourceId(problem: Obj): string | null {
  const value = problem.leetcodeId;
  return value === undefined || value === null ? null : stringifyLosslessJson(value);
}

async function prepareImport(raw: string, admin: boolean) {
  const normalized = normal(raw);
  const p = object(content(normalized).problem);
  const slug = str(p.slug);
  const leetcode = sourceId(p);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120)
    throw bad("Choose a valid question slug");
  if (leetcode !== null && (!/^[1-9]\d{0,9}$/.test(leetcode) || Number(leetcode) > 2147483647))
    throw bad("Invalid LeetCode ID");
  if (leetcode !== null && !admin) throw forbidden();
  try {
    validateQuestionSchema(normalized);
  } catch {
    throw bad("Invalid question schema");
  }
  return { normalized, slug, leetcode, digest: await contentDigest(normalized) };
}

/** Compare authored content without identity fields or generated starter code. */
function comparablePublication(raw: string): Obj {
  const value = content(raw);
  const problem = object(value.problem);
  delete problem.id;
  delete problem.version;
  problem.companies = list(problem.companies).map(str).sort();
  for (const key of ["implementations", "solutions"] as const) {
    value[key] = list(value[key])
      .map(object)
      .sort((a, b) => str(a.language).localeCompare(str(b.language)));
  }
  for (const implementation of list(value.implementations))
    delete object(implementation).starterSource;
  const stages = list(problem.odyssey ? object(problem.odyssey).levels : undefined);
  const groups = [
    problem.examples,
    value.hiddenCases,
    ...list(value.odysseyHiddenCases),
    ...stages.map((stage) => object(stage).examples),
  ];
  for (const group of groups)
    for (const item of list(group)) {
      const test = object(item);
      if (!list(test.calls).length) delete test.calls;
      if (test.explanation === "") delete test.explanation;
    }
  if (!list(value.odysseyHiddenCases).length) delete value.odysseyHiddenCases;
  return value;
}

async function importItem(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  item: Awaited<ReturnType<typeof prepareImport>>,
  preview: boolean,
  runtime: RuntimeResolver,
) {
  const { normalized, slug, leetcode, digest } = item;
  const [receipt] = (
    await tx.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM question_drafts
      WHERE created_by=${actor.userId} AND import_digest=${digest} AND published_version_id IS NULL
        AND (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin}))
    `)
  ).rows;
  if (receipt) return JSON.stringify({ status: "existing", draftId: receipt.id });

  const publications = (
    await tx.execute<{
      id: string | null;
      token: string | null;
      slug: string;
      source: string | null;
    }>(sql`
    SELECT v.id::text,v.xmin::text AS token,p.slug,p.leetcode_id::text AS source
    FROM problems p LEFT JOIN problem_versions v ON v.id=p.current_version_id
    WHERE (p.owner_id IS NULL OR p.owner_id=${actor.userId})
      AND (p.slug=${slug} OR p.leetcode_id=${leetcode}::integer)
  `)
  ).rows;
  const published = publications[0];
  let edit: { id: string; token: string } | undefined;
  let changeMessage: string | undefined;
  let input = normalized;
  if (published) {
    if (publications.length !== 1 || !admin || !published.id || !published.token)
      return JSON.stringify({
        status: "conflict",
        message: "Published question identity needs review",
      });

    const [saved] = (
      await tx.execute<DraftRow>(sql`
      SELECT ${draftColumns} FROM question_drafts WHERE published_version_id=${published.id}::uuid
      ORDER BY updated_at DESC,id LIMIT 1
    `)
    ).rows;
    const current =
      saved?.content ?? (await readAuthoringQuestion(tx, actor.userId, published.id, admin, false));
    if (!current)
      return JSON.stringify({ status: "conflict", message: "Published question unavailable" });
    const incoming = content(normalized);
    object(incoming.problem).slug = published.slug;
    input = stringifyLosslessJson(incoming);
    const before = comparablePublication(current);
    const after = comparablePublication(input);
    if (stringifyLosslessJson(before) === stringifyLosslessJson(after))
      return JSON.stringify({ status: "unchanged", message: "Already current" });
    if (!leetcode || published.source !== leetcode)
      return JSON.stringify({
        status: "conflict",
        message: "Published question identity needs review",
      });
    const sections = [
      ["question", before.problem, after.problem],
      ["hidden tests", before.hiddenCases, after.hiddenCases],
      ["stage tests", before.odysseyHiddenCases, after.odysseyHiddenCases],
      ["language implementations", before.implementations, after.implementations],
      ["solutions", before.solutions, after.solutions],
      ["attribution", before.attribution, after.attribution],
    ] as const;
    const changed = sections
      .filter(([, a, b]) => stringifyLosslessJson(a ?? null) !== stringifyLosslessJson(b ?? null))
      .map(([label]) => label);
    changeMessage = `Review update to ${published.slug} (${changed.join(", ") || "content"})`;
    edit = { id: published.id, token: published.token };
  }

  const matching = (
    await tx.execute<DraftRow>(sql`
      SELECT ${draftColumns} FROM question_drafts
      WHERE (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin}))
        AND published_version_id IS NULL
        AND (content->'problem'->>'slug'=${published?.slug ?? slug} OR content->'problem'->>'leetcodeId'=${leetcode} OR edit_version_id=${edit?.id ?? null}::uuid)
      LIMIT 2
    `)
  ).rows;
  if (matching.length) {
    if (matching.length === 1 && normal(matching[0].content) === input)
      return JSON.stringify({ status: "existing", draftId: matching[0].id });
    return JSON.stringify({
      status: "conflict",
      message: "A draft already uses this slug or source ID",
    });
  }

  if (preview) {
    let warning: string | undefined;
    try {
      validateQuestionPublication(normalized, validateQuestionSchema, runtime);
    } catch {
      warning = "Draft can be imported but needs edits before publication.";
    }
    return JSON.stringify({ status: "ready", warning, message: changeMessage });
  }
  const draft = content(await create(tx, actor, admin, input, digest, edit));
  return JSON.stringify({ status: "created", draftId: draft.id });
}

function preparePublication(raw: string, runtime: RuntimeResolver) {
  const c = content(raw),
    p = object(c.problem),
    odyssey = p.odyssey ? object(p.odyssey) : undefined,
    levels = odyssey ? list(odyssey.levels) : [];
  const methods = levels.length ? list(object(levels[0]).methods) : [p.signature];
  for (const item of list(c.implementations)) {
    const impl = object(item);
    try {
      impl.starterSource = generateStarter(
        JSON.parse(stringifyLosslessJson(methods)) as Signature[],
        str(impl.language) as StarterLanguage,
        !!odyssey,
      );
    } catch (error) {
      throw bad(error instanceof Error ? error.message : "Invalid starter");
    }
  }
  try {
    validateQuestionPublication(stringifyLosslessJson(c), validateQuestionSchema, runtime);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : "Invalid question content");
  }
  return { c, p };
}

async function editPublication(
  tx: Transaction,
  actor: AuthorActor,
  draft: DraftRow,
  raw: string,
  runtime: RuntimeResolver,
): Promise<string> {
  const versionId = (draft.publishedVersionId ?? draft.editVersionId)!;
  if (draft.ownerId === null && !actor.globalAllowed)
    throw new ApplicationError(
      "step_up_required",
      "Verify your passkey again to edit a global question",
      403,
    );
  const { c, p } = preparePublication(raw, runtime);
  await lockIdentity(tx, str(p.slug), sourceId(p));
  const parent = await lockPublication(tx, versionId);
  if (draft.editVersionId && (parent.token !== draft.editBase || parent.current !== versionId))
    throw conflict();
  if (parent.owner !== draft.ownerId || parent.slug !== p.slug)
    throw bad("Keep the published question slug and ownership");
  if (parent.owner !== null && sourceId(p) !== null)
    throw bad("LeetCode IDs are reserved for global questions");
  p.id = versionId;
  p.version = String(parent.version);
  await assertPublicationIdle(tx, versionId);
  const missingLanguage = (
    await tx.execute(sql`
    SELECT 1 FROM workspaces WHERE problem_version_id=${versionId}::uuid
      AND language NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(list(c.implementations).map((item) => str(object(item).language)))}::jsonb))
    LIMIT 1
  `)
  ).rows.length;
  if (missingLanguage) throw bad("Keep languages used by existing workspaces");
  await tx.execute(sql`SET CONSTRAINTS workspace_problem_language_fkey,
    matches_problem_version_id_fkey,matches_selected_problem_version_id_fkey,
    question_drafts_published_version_id_fkey,question_drafts_edit_version_fkey,
    runner_job_inputs_version_id_fkey DEFERRED`);
  await removePublicationRow(tx, versionId);
  const replacement = stringifyLosslessJson(c);
  await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
  await persistQuestionVersion(
    tx,
    replacement,
    parent.id,
    versionId,
    parent.version,
    parent.owner,
    runtime,
    parent.current === versionId,
  );
  return replacement;
}

async function publish(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  id: string,
  revisionValue: string,
  visibility: "" | "private" | "global",
  runtime: RuntimeResolver,
  operatorSeedSource?: string,
): Promise<string> {
  const d = await readDraft(tx, actor, admin, id, true);
  if (d.revision !== revisionValue || d.publishedVersionId) throw conflict();
  if (d.editVersionId) {
    if (visibility === "private") throw bad("Imported edits keep the published visibility");
    const replacement = await editPublication(tx, actor, d, d.content, runtime);
    const updated = store(replacement);
    await tx.execute(
      sql`DELETE FROM question_drafts WHERE published_version_id=${d.editVersionId}::uuid`,
    );
    const [saved] = (
      await tx.execute<DraftRow>(sql`
      UPDATE question_drafts SET published_version_id=edit_version_id,edit_version_id=NULL,edit_base=NULL,import_digest=NULL,
        content=${updated.safe}::jsonb,lossless_content=${updated.lossless},revision=revision+1,
        updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id=${id}::uuid RETURNING ${draftColumns}
    `)
    ).rows;
    return draftJson(saved);
  }
  const { c, p } = preparePublication(d.content, runtime);
  let privateOwner = d.ownerId;
  if (visibility === "global") {
    if (!admin)
      throw new ApplicationError("forbidden", "Only administrators can publish globally", 403);
    privateOwner = null;
  } else if (visibility === "private") privateOwner = actor.userId;
  if (privateOwner === null && !actor.globalAllowed)
    throw new ApplicationError(
      "step_up_required",
      "Sign in with a verified passkey again before publishing globally",
      403,
    );
  let slug = str(p.slug);
  const actorPrefix = `private-${(await contentDigest(privateOwner ?? actor.userId)).slice(0, 16)}-`;
  if (slug.startsWith(actorPrefix)) slug = slug.slice(actorPrefix.length);
  if (privateOwner) {
    if (new TextEncoder().encode(slug).length > 96)
      throw bad("Private question slug must be 96 characters or fewer");
    slug = `${actorPrefix}${slug}`;
  }
  p.slug = slug;
  if (privateOwner && p.leetcodeId !== undefined && p.leetcodeId !== null)
    throw bad("LeetCode IDs are reserved for global questions");
  await lockIdentity(tx, slug, sourceId(p));
  await tx.execute(
    sql`INSERT INTO problems(slug,owner_id) VALUES(${slug},${privateOwner}) ON CONFLICT(slug) DO NOTHING`,
  );
  const [existing] = (
    await tx.execute<{ id: string; owner: string | null }>(
      sql`SELECT id::text AS id,owner_id AS owner FROM problems WHERE slug=${slug} FOR UPDATE`,
    )
  ).rows;
  if (!existing) throw new Error("problem namespace unavailable");
  if (privateOwner ? existing.owner !== privateOwner : existing.owner !== null)
    throw privateOwner
      ? new ApplicationError("forbidden", "Private question namespace unavailable", 403)
      : bad("Choose a new slug for global publication");
  const [next] = (
    await tx.execute<{ version: number }>(
      sql`SELECT COALESCE(MAX(version),0)+1 AS version FROM problem_versions WHERE problem_id=${existing.id}::uuid`,
    )
  ).rows;
  const versionId = crypto.randomUUID();
  p.id = versionId;
  p.version = String(next.version);
  await persistQuestionVersion(
    tx,
    stringifyLosslessJson(c),
    existing.id,
    versionId,
    next.version,
    privateOwner,
    runtime,
  );
  const publishedContent = stringifyLosslessJson(c);
  const updated = store(publishedContent);
  if (operatorSeedSource !== undefined)
    updated.lossless =
      preserveCaseLiterals(operatorSeedSource, publishedContent) ?? updated.lossless;
  const [saved] = (
    await tx.execute<DraftRow>(
      sql`UPDATE question_drafts SET owner_id=${privateOwner},published_version_id=${versionId}::uuid,import_digest=NULL,content=${updated.safe}::jsonb,lossless_content=${updated.lossless},revision=revision+1,updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id::text=${id} RETURNING ${draftColumns}`,
    )
  ).rows;
  await tx.execute(
    sql`INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES(${"publish:" + versionId},${actor.userId},${actor.userId},'questions.publish',${id},'Explicit publication')`,
  );
  return draftJson(saved);
}
async function cloneVersion(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  id: string,
): Promise<string> {
  const value = await readAuthoringQuestion(tx, actor.userId, id, admin);
  if (value) return value;
  if (!admin)
    throw new ApplicationError("forbidden", "Only your own private questions can be cloned", 403);
  throw new ApplicationError("not_found", "Problem not found", 404);
}
/** Open one bounded transaction per authoring operation; publication never leaves a partial version. */
function createQuestionAuthoring(
  run: AuthoringScope,
  runtime: RuntimeResolver,
  operatorSeedSource?: string,
): QuestionAuthoring {
  const transact = <T>(action: (tx: Transaction) => Promise<T>, readOnly = false) =>
    run((scope) => scope.transaction({ ...opts, readOnly }, action));
  return {
    async publications(actor) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        const result = await tx.execute(sql`
          SELECT chosen.id::text,chosen.title,p.slug,chosen.version::text,
                 COALESCE(chosen.id=p.current_version_id,false) AS current
          FROM problems p
          CROSS JOIN LATERAL (
            SELECT v.id,v.title,v.version FROM problem_versions v WHERE v.problem_id=p.id AND v.sealed
            ORDER BY (v.id IS NOT DISTINCT FROM p.current_version_id) DESC,v.version DESC LIMIT 1
          ) chosen
          WHERE p.owner_id=${actor.userId} OR (p.owner_id IS NULL AND ${admin})
          ORDER BY lower(chosen.title),p.slug
        `);
        return JSON.stringify({ items: result.rows });
      }, true);
    },
    async list(actor, cursor) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        const rows = (
          await tx.execute<{
            id: string;
            revision: string;
            title: string;
            slug: string;
            publishedVersionId: string | null;
            updatedAt: string;
          }>(
            sql`SELECT id::text AS id,revision::text AS revision,COALESCE(content->'problem'->>'title','') AS title,COALESCE(content->'problem'->>'slug','') AS slug,published_version_id::text AS "publishedVersionId",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM question_drafts WHERE published_version_id IS NULL AND (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin})) AND (${cursor}='' OR (updated_at,id)<(SELECT updated_at,id FROM question_drafts WHERE id::text=${cursor} AND (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin})))) ORDER BY updated_at DESC,id DESC LIMIT 51`,
          )
        ).rows;
        const more = rows.length > 50,
          items = rows
            .slice(0, 50)
            .map(({ publishedVersionId, ...row }) =>
              publishedVersionId ? { ...row, publishedVersionId } : row,
            );
        return JSON.stringify({ items, ...(more ? { nextCursor: items[49].id } : {}) });
      }, true);
    },
    async get(actor, id) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        return draftJson(await readDraft(tx, actor, admin, id));
      }, true);
    },
    async create(actor, raw, versionId, edit = false) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        const target = edit && versionId ? await lockPublication(tx, versionId) : undefined;
        if (target && target.owner !== actor.userId && (target.owner !== null || !admin))
          throw missing();
        const source =
          raw ??
          (versionId
            ? await cloneVersion(tx, actor, admin, versionId)
            : (() => {
                throw bad("Provide content or problemVersionId");
              })());
        if (target && versionId) {
          const [existing] = (
            await tx.execute<DraftRow>(sql`
            SELECT ${draftColumns} FROM question_drafts WHERE published_version_id=${versionId}::uuid
            ORDER BY updated_at DESC,id LIMIT 1
          `)
          ).rows;
          if (existing) return draftJson(existing);
          const data = store(source);
          const [row] = (
            await tx.execute<DraftRow>(sql`
            INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,owner_id,published_version_id)
            VALUES(${data.safe}::jsonb,${data.lossless},${actor.userId},${actor.userId},${target.owner},${versionId}::uuid)
            RETURNING ${draftColumns}
          `)
          ).rows;
          return draftJson(row);
        }
        return create(tx, actor, admin, source);
      });
    },
    async importDraft(actor, raw, preview) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, !preview);
        const item = await prepareImport(raw, admin);
        if (!preview) await lockIdentity(tx, item.slug, item.leetcode);
        return importItem(tx, actor, admin, item, preview, runtime);
      }, preview);
    },
    async importDraftBatch(actor, raws, preview) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, !preview);
        const items = await Promise.all(
          raws.map(async (raw) => {
            try {
              return await prepareImport(raw, admin);
            } catch (error) {
              if (!(error instanceof ApplicationError)) throw error;
              return { status: "invalid", message: error.message } as const;
            }
          }),
        );
        if (!preview) {
          const identities = items.flatMap((item) =>
            "slug" in item ? [{ slug: item.slug, source: item.leetcode }] : [],
          );
          // Match the single-item lock order. Sort within each namespace for overlapping batches.
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(key)
            FROM (
              SELECT DISTINCT 0 AS phase, hashtextextended(slug,740071) AS key
              FROM jsonb_to_recordset(${JSON.stringify(identities)}::jsonb) AS i(slug text, source text)
              UNION ALL
              SELECT DISTINCT 1 AS phase, hashtextextended(source,740072) AS key
              FROM jsonb_to_recordset(${JSON.stringify(identities)}::jsonb) AS i(slug text, source text)
              WHERE source IS NOT NULL
            ) locks ORDER BY phase,key
          `);
        }
        const results: string[] = [];
        for (const item of items)
          results.push(
            "status" in item
              ? JSON.stringify(item)
              : await importItem(tx, actor, admin, item, preview, runtime),
          );
        return `{"items":[${results.join(",")}]}`;
      }, preview);
    },
    async update(actor, id, rev, raw) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        revision(rev);
        await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
        const previous = await readDraft(tx, actor, admin, id, true);
        if (previous.revision !== rev) throw conflict();
        const normalized = normal(raw);
        const data = store(
          previous.publishedVersionId
            ? await editPublication(tx, actor, previous, normalized, runtime)
            : normalized,
        );
        const [row] = (
          await tx.execute<DraftRow>(
            sql`UPDATE question_drafts SET content=${data.safe}::jsonb,lossless_content=${data.lossless},revision=revision+1,updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id::text=${id} RETURNING ${draftColumns}`,
          )
        ).rows;
        return draftJson(row);
      });
    },
    async deletionImpact(actor, id) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        const d = await readDraft(tx, actor, admin, id);
        if (!d.publishedVersionId) throw missing();
        const version = await lockPublication(tx, d.publishedVersionId);
        return JSON.stringify({
          ...(await publicationImpact(tx, d.publishedVersionId, version.id)),
          current: version.current === d.publishedVersionId,
        });
      });
    },
    async deletePublication(actor, id, rev, replacement) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        const d = await readDraft(tx, actor, admin, id, true);
        revision(rev);
        if (!d.publishedVersionId || d.revision !== rev) throw conflict();
        if (d.ownerId === null && !actor.globalAllowed)
          throw new ApplicationError(
            "step_up_required",
            "Verify your passkey again to delete a global question",
            403,
          );
        const versionId = d.publishedVersionId;
        const version = await lockPublication(tx, versionId);
        await assertPublicationIdle(tx, versionId);
        if (version.current === versionId) {
          if (replacement === undefined)
            throw bad("Choose a replacement or unpublish the question");
          if (replacement) {
            const valid = (
              await tx.execute(sql`SELECT 1 FROM problem_versions
              WHERE id=${replacement}::uuid AND id<>${versionId}::uuid AND problem_id=${version.id}::uuid AND sealed`)
            ).rows.length;
            if (!valid) throw bad("Choose another published version of this question");
            const [saved] = (
              await tx.execute<DraftRow>(sql`
              SELECT ${draftColumns} FROM question_drafts WHERE published_version_id=${replacement}::uuid
              ORDER BY updated_at DESC,id LIMIT 1
            `)
            ).rows;
            const raw =
              saved?.content ??
              (await readAuthoringQuestion(tx, actor.userId, replacement, admin, false));
            if (raw)
              await updateQuestionCatalogMetadata(
                tx,
                version.id,
                object(content(raw).problem),
                version.owner,
              );
          }
          await tx.execute(
            sql`UPDATE problems SET current_version_id=${replacement}::uuid WHERE id=${version.id}::uuid`,
          );
        } else if (replacement !== undefined) {
          throw conflict();
        }
        await detachPublication(tx, versionId);
        await removePublicationRow(tx, versionId);
        await tx.execute(sql`DELETE FROM problems p WHERE p.id=${version.id}::uuid
          AND NOT EXISTS (SELECT 1 FROM problem_versions v WHERE v.problem_id=p.id)`);
        return '{"deleted":true}';
      });
    },
    async publish(actor, id, rev, visibility) {
      if (!["", "private", "global"].includes(visibility))
        throw bad("Choose private or global publication");
      try {
        return await transact(async (tx) => {
          const { admin } = await author(tx, actor, true);
          revision(rev);
          await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
          return publish(tx, actor, admin, id, rev, visibility, runtime, operatorSeedSource);
        });
      } catch (error) {
        if (classifyDatabaseError(error) === "unique") throw bad("LeetCode ID is already in use");
        throw error;
      }
    },
  };
}

export function questionAuthoring(
  run: AuthoringScope,
  runtime: RuntimeResolver,
): QuestionAuthoring {
  return createQuestionAuthoring(run, runtime);
}
/** Only trusted operator provisioning supplies original seed case spelling. */
export function operatorQuestionAuthoring(
  run: AuthoringScope,
  runtime: RuntimeResolver,
  source: string,
): QuestionAuthoring {
  return createQuestionAuthoring(run, runtime, source);
}

/** Trusted provisioning may restore equivalent source spellings on an existing seeded draft. */
export async function preservePublishedOperatorSeed(
  run: AuthoringScope,
  actor: AuthorActor,
  id: string,
  source: string,
): Promise<void> {
  await run((scope) =>
    scope.transaction(opts, async (tx) => {
      const { admin } = await author(tx, actor, true);
      if (!admin || !actor.globalAllowed) throw forbidden();
      const draft = await readDraft(tx, actor, admin, id, true);
      if (!draft.publishedVersionId) throw conflict();
      const preserved = preserveCaseLiterals(source, draft.content);
      if (preserved)
        await tx.execute(
          sql`UPDATE question_drafts SET lossless_content=${preserved} WHERE id=${id}::uuid`,
        );
    }),
  );
}
