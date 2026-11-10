/** @file repository.ts @description Atomic question drafts and publication edits. @module problems */
import { sql } from "drizzle-orm";
import {
  classifyDatabaseError,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import {
  normalizeQuestionDraft,
  questionLanguages,
  questionPublicationSlug,
  questionSlugFits,
  parseLosslessJson,
  stringifyLosslessJson,
  validateQuestionPublication,
  validateQuestionSchema,
  type JsonValue,
  type RuntimeResolver,
} from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  AuthorActor,
  QuestionAuthoring,
} from "../../../../modules/problems/authoring/ports.ts";
import { object, storageProjection } from "../storage.ts";
import { persistQuestionPublication } from "../publication.ts";
import { readAuthoringQuestion } from "../private-content.ts";
import { preserveCaseLiterals } from "../case-literals.ts";
import { authoringQueries } from "./queries.ts";
import { activeGrants, hasGrant } from "../../access/active-grants.ts";
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
    const grants = await activeGrants(
      tx,
      actor.userId,
      ["questions.custom"],
      lock ? "share" : "read",
    );
    if (!hasGrant(grants, "questions.custom")) throw forbidden();
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
  `id::text AS id,revision::text AS revision,convert_from(COALESCE(lossless_content,convert_to(content::text,'UTF8')),'UTF8') AS content,published_publication_id::text AS "publishedVersionId",edit_publication_id::text AS "editVersionId",edit_base AS "editBase",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",owner_id AS "ownerId"`,
);
function draftJson(row: DraftRow): string {
  const d: Obj = {
    id: row.id,
    revision: row.revision,
    content: parseLosslessJson(normal(row.content)),
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
      sql`INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,owner_id,import_digest,edit_publication_id,edit_base) VALUES(${data.safe}::jsonb,${data.lossless},${actor.userId},${actor.userId},${admin ? null : actor.userId},${digest ?? null},${edit?.id ?? null}::uuid,${edit?.token ?? null}) RETURNING ${draftColumns}`,
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
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) || !questionSlugFits(slug))
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

/** Compare authored content without publication identity fields. */
function comparablePublication(raw: string): Obj {
  const value = content(raw);
  const problem = object(value.problem);
  delete problem.id;
  delete problem.version;
  problem.companies = list(problem.companies).map(str).sort();
  const stages = list(problem.odyssey ? object(problem.odyssey).levels : undefined);
  const groups = [
    problem.examples,
    value.hiddenCases,
    ...stages.map((level) => object(level).hiddenCases),
    ...stages.map((stage) => object(stage).examples),
  ];
  for (const group of groups)
    for (const item of list(group)) {
      const test = object(item);
      if (!list(test.calls).length) delete test.calls;
      if (test.explanation === "") delete test.explanation;
    }
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
      WHERE created_by=${actor.userId} AND import_digest=${digest} AND published_publication_id IS NULL
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
    FROM problems p LEFT JOIN question_publications v ON v.id=p.current_publication_id
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
      SELECT ${draftColumns} FROM question_drafts WHERE published_publication_id=${published.id}::uuid
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
      ["canonical approach", before.canonicalApproachId, after.canonicalApproachId],
      ["approaches", before.approaches, after.approaches],
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
        AND published_publication_id IS NULL
        AND (content->'problem'->>'slug'=${published?.slug ?? slug} OR content->'problem'->>'leetcodeId'=${leetcode} OR edit_publication_id=${edit?.id ?? null}::uuid)
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
    p = object(c.problem);
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
  const publicationId = (draft.publishedVersionId ?? draft.editVersionId)!;
  const { c, p } = preparePublication(raw, runtime);
  await lockIdentity(tx, str(p.slug), sourceId(p));
  const parent = await lockPublication(tx, publicationId);
  if (parent.current !== publicationId || (draft.editVersionId && parent.token !== draft.editBase))
    throw conflict();
  if (parent.owner !== draft.ownerId || parent.slug !== p.slug)
    throw bad("Keep the published question slug and ownership");
  if (parent.owner !== null && sourceId(p) !== null)
    throw bad("LeetCode IDs are reserved for global questions");
  p.id = publicationId;
  await assertPublicationIdle(tx, publicationId);
  const missingLanguage = (
    await tx.execute(sql`
    SELECT 1 FROM workspaces WHERE publication_id=${publicationId}::uuid
      AND language NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(questionLanguages(!!p.sql))}::jsonb))
    LIMIT 1
  `)
  ).rows.length;
  if (missingLanguage) throw bad("Keep languages used by existing workspaces");
  await tx.execute(sql`SET CONSTRAINTS workspace_publication_fkey,
    matches_publication_id_fkey,matches_selected_publication_id_fkey,
    question_drafts_published_publication_id_fkey,question_drafts_edit_publication_fkey,
    runner_job_inputs_publication_id_fkey,question_exposure_publication_id_fkey,question_learning_events_publication_id_fkey,
    recommendation_impressions_publication_id_fkey DEFERRED`);
  // Recommendation metadata belongs to the stable publication ID.
  await tx.execute(
    sql`SELECT set_config('quorem.question_replacement',${publicationId}::uuid::text,true)`,
  );
  await removePublicationRow(tx, publicationId);
  const replacement = stringifyLosslessJson(c);
  await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
  await persistQuestionPublication(
    tx,
    replacement,
    parent.id,
    publicationId,
    parent.owner,
    runtime,
  );
  await tx.execute(sql`SELECT set_config('quorem.question_replacement','',true)`);
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
      sql`DELETE FROM question_drafts WHERE published_publication_id=${d.editVersionId}::uuid`,
    );
    const [saved] = (
      await tx.execute<DraftRow>(sql`
      UPDATE question_drafts SET published_publication_id=edit_publication_id,edit_publication_id=NULL,edit_base=NULL,import_digest=NULL,
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

  let slug: string;
  try {
    slug = await questionPublicationSlug(str(p.slug), privateOwner, privateOwner ?? actor.userId);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : "Invalid question slug");
  }
  p.slug = slug;
  if (privateOwner && p.leetcodeId !== undefined && p.leetcodeId !== null)
    throw bad("LeetCode IDs are reserved for global questions");
  await lockIdentity(tx, slug, sourceId(p));
  const [existing] = (
    await tx.execute<{ id: string }>(
      sql`INSERT INTO problems(slug,owner_id) VALUES(${slug},${privateOwner}) ON CONFLICT(slug) DO NOTHING RETURNING id::text AS id`,
    )
  ).rows;
  if (!existing) throw bad("Choose a new question slug");
  const publicationId = crypto.randomUUID();
  p.id = publicationId;
  await persistQuestionPublication(
    tx,
    stringifyLosslessJson(c),
    existing.id,
    publicationId,
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
      sql`UPDATE question_drafts SET owner_id=${privateOwner},published_publication_id=${publicationId}::uuid,import_digest=NULL,content=${updated.safe}::jsonb,lossless_content=${updated.lossless},revision=revision+1,updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id::text=${id} RETURNING ${draftColumns}`,
    )
  ).rows;
  await tx.execute(
    sql`INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES(${"publish:" + publicationId},${actor.userId},${actor.userId},'questions.publish',${id},'Explicit publication')`,
  );
  return draftJson(saved);
}
async function clonePublication(
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
async function deleteDraft(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  id: string,
  rev: string,
): Promise<void> {
  revision(rev);
  const draft = await readDraft(tx, actor, admin, id, true);
  if (draft.revision !== rev || draft.publishedVersionId) throw conflict();
  await tx.execute(sql`DELETE FROM question_drafts WHERE id=${id}::uuid`);
}

function authorizePublicationDeletion(
  actor: AuthorActor,
  admin: boolean,
  owner: string | null,
): void {
  if (owner !== actor.userId && (owner !== null || !admin)) throw missing();
  if (owner === null && !actor.globalAllowed)
    throw new ApplicationError(
      "step_up_required",
      "Confirm your identity before deleting a global question",
      403,
    );
}

/** Caller holds the publication lock and has checked ownership and step-up. */
async function deletePublication(
  tx: Transaction,
  publicationId: string,
  publication: Awaited<ReturnType<typeof lockPublication>>,
): Promise<void> {
  await assertPublicationIdle(tx, publicationId);
  if (publication.current !== publicationId) throw conflict();
  await tx.execute(
    sql`UPDATE problems SET current_publication_id=NULL WHERE id=${publication.id}::uuid`,
  );
  await detachPublication(tx, publicationId);
  await removePublicationRow(tx, publicationId);
  await tx.execute(sql`DELETE FROM problems p WHERE p.id=${publication.id}::uuid
          AND NOT EXISTS (SELECT 1 FROM question_publications v WHERE v.problem_id=p.id)`);
}

/** Open one bounded transaction per authoring operation; publication writes are atomic. */
function createQuestionAuthoring(
  run: AuthoringScope,
  runtime: RuntimeResolver,
  operatorSeedSource?: string,
): QuestionAuthoring {
  const transact = <T>(action: (tx: Transaction) => Promise<T>, readOnly = false) =>
    run((scope) =>
      scope.transaction(
        { ...opts, readOnly, isolation: readOnly ? "repeatable read" : "read committed" },
        action,
      ),
    );
  return {
    async mutateBatch(actor, batch) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
        const items = [];
        // Preserve selection order for shared slugs; isolate expected row failures.
        for (let index = 0; index < batch.items.length; index++) {
          const id = batch.items[index].id;
          await tx.execute(sql`SAVEPOINT question_item`);
          try {
            if (batch.action === "publish") {
              const item = batch.items[index];
              revision(item.revision);
              await publish(
                tx,
                actor,
                admin,
                id,
                item.revision,
                item.visibility,
                runtime,
                operatorSeedSource,
              );
            } else if (batch.action === "delete-drafts") {
              await deleteDraft(tx, actor, admin, id, batch.items[index].revision);
            } else {
              const publication = await lockPublication(tx, id);
              authorizePublicationDeletion(actor, admin, publication.owner);
              await deletePublication(tx, id, publication);
            }
            items.push({ id, status: "succeeded" });
          } catch (error) {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT question_item`);
            const failure =
              classifyDatabaseError(error) === "unique"
                ? bad("LeetCode ID is already in use")
                : error;
            if (!(failure instanceof ApplicationError)) throw failure;
            items.push({ id, status: "failed", code: failure.code, message: failure.message });
          }
          await tx.execute(sql`RELEASE SAVEPOINT question_item`);
        }
        return JSON.stringify({ items });
      });
    },
    ...authoringQueries(transact, author, (raw) => preparePublication(raw, runtime)),
    async get(actor, id) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        return draftJson(await readDraft(tx, actor, admin, id));
      }, true);
    },
    async create(actor, raw, publicationId) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        if ((raw === undefined) === (publicationId === undefined))
          throw bad("Provide content or problemVersionId");
        const target = publicationId ? await lockPublication(tx, publicationId) : undefined;
        if (target && target.current !== publicationId) throw missing();
        if (target && target.owner !== actor.userId && (target.owner !== null || !admin))
          throw missing();
        const source =
          raw ??
          (publicationId
            ? await clonePublication(tx, actor, admin, publicationId)
            : (() => {
                throw bad("Provide content or problemVersionId");
              })());
        if (target && publicationId) {
          const [existing] = (
            await tx.execute<DraftRow>(sql`
            SELECT ${draftColumns} FROM question_drafts WHERE published_publication_id=${publicationId}::uuid
            ORDER BY updated_at DESC,id LIMIT 1
          `)
          ).rows;
          if (existing) return draftJson(existing);
          const data = store(source);
          const [row] = (
            await tx.execute<DraftRow>(sql`
            INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,owner_id,published_publication_id)
            VALUES(${data.safe}::jsonb,${data.lossless},${actor.userId},${actor.userId},${target.owner},${publicationId}::uuid)
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
            sql`UPDATE question_drafts SET content=${data.safe}::jsonb,lossless_content=${data.lossless},import_digest=NULL,revision=revision+1,updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id::text=${id} RETURNING ${draftColumns}`,
          )
        ).rows;
        return draftJson(row);
      });
    },
    async deleteDraft(actor, id, rev) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        await deleteDraft(tx, actor, admin, id, rev);
        return '{"deleted":true}';
      });
    },
    async deletionImpact(actor, id) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, false);
        const d = await readDraft(tx, actor, admin, id);
        if (!d.publishedVersionId) throw missing();
        const publication = await lockPublication(tx, d.publishedVersionId);
        if (publication.current !== d.publishedVersionId) throw missing();
        return JSON.stringify({
          ...(await publicationImpact(tx, d.publishedVersionId)),
        });
      });
    },
    async deletePublication(actor, id, rev) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        const d = await readDraft(tx, actor, admin, id, true);
        revision(rev);
        if (!d.publishedVersionId || d.revision !== rev) throw conflict();
        authorizePublicationDeletion(actor, admin, d.ownerId);
        const publicationId = d.publishedVersionId;
        const publication = await lockPublication(tx, publicationId);
        await deletePublication(tx, publicationId, publication);
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
