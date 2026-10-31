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
import { persistQuestionVersion } from "../publication.ts";
import { readAuthoringQuestion } from "../private-content.ts";

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
  updatedAt: string;
  ownerId: string | null;
};
const draftColumns = sql.raw(
  `id::text AS id,revision::text AS revision,convert_from(COALESCE(lossless_content,convert_to(content::text,'UTF8')),'UTF8') AS content,published_version_id::text AS "publishedVersionId",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",owner_id AS "ownerId"`,
);
function draftJson(row: DraftRow): string {
  const d: Obj = {
    id: row.id,
    revision: row.revision,
    content: parseLosslessJson(row.content),
    updatedAt: row.updatedAt,
  };
  if (row.publishedVersionId) d.publishedVersionId = row.publishedVersionId;
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
): Promise<string> {
  const data = store(normal(raw));
  const rows = (
    await tx.execute<DraftRow>(
      sql`INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,owner_id) VALUES(${data.safe}::jsonb,${data.lossless},${actor.userId},${actor.userId},${admin ? null : actor.userId}) RETURNING ${draftColumns}`,
    )
  ).rows;
  return draftJson(rows[0]);
}
async function hashPrefix(text: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
async function publish(
  tx: Transaction,
  actor: AuthorActor,
  admin: boolean,
  id: string,
  revisionValue: string,
  visibility: "" | "private" | "global",
  runtime: RuntimeResolver,
): Promise<string> {
  const d = await readDraft(tx, actor, admin, id, true);
  if (d.revision !== revisionValue || d.publishedVersionId) throw conflict();
  const c = content(d.content),
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
  const actorPrefix = `private-${await hashPrefix(privateOwner ?? actor.userId)}-`;
  if (slug.startsWith(actorPrefix)) slug = slug.slice(actorPrefix.length);
  if (privateOwner) {
    if (new TextEncoder().encode(slug).length > 96)
      throw bad("Private question slug must be 96 characters or fewer");
    slug = `${actorPrefix}${slug}`;
  }
  p.slug = slug;
  if (privateOwner && p.leetcodeId !== undefined && p.leetcodeId !== null)
    throw bad("LeetCode IDs are reserved for global questions");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${slug},740071))`);
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
  const updated = store(stringifyLosslessJson(c));
  const [saved] = (
    await tx.execute<DraftRow>(
      sql`UPDATE question_drafts SET owner_id=${privateOwner},published_version_id=${versionId}::uuid,content=${updated.safe}::jsonb,lossless_content=${updated.lossless},revision=revision+1,updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id::text=${id} RETURNING ${draftColumns}`,
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
export function questionAuthoring(
  run: AuthoringScope,
  runtime: RuntimeResolver,
): QuestionAuthoring {
  const transact = <T>(action: (tx: Transaction) => Promise<T>, readOnly = false) =>
    run((scope) => scope.transaction({ ...opts, readOnly }, action));
  return {
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
            sql`SELECT id::text AS id,revision::text AS revision,COALESCE(content->'problem'->>'title','') AS title,COALESCE(content->'problem'->>'slug','') AS slug,published_version_id::text AS "publishedVersionId",to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM question_drafts WHERE (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin})) AND (${cursor}='' OR (updated_at,id)<(SELECT updated_at,id FROM question_drafts WHERE id::text=${cursor} AND (owner_id=${actor.userId} OR (owner_id IS NULL AND ${admin})))) ORDER BY updated_at DESC,id DESC LIMIT 51`,
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
    async create(actor, raw, versionId) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        const source =
          raw ??
          (versionId
            ? await cloneVersion(tx, actor, admin, versionId)
            : (() => {
                throw bad("Provide content or problemVersionId");
              })());
        return create(tx, actor, admin, source);
      });
    },
    async update(actor, id, rev, raw) {
      return transact(async (tx) => {
        const { admin } = await author(tx, actor, true);
        revision(rev);
        const data = store(normal(raw));
        await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
        const previous = await readDraft(tx, actor, admin, id, true);
        if (previous.revision !== rev || previous.publishedVersionId) throw conflict();
        const [row] = (
          await tx.execute<DraftRow>(
            sql`UPDATE question_drafts SET content=${data.safe}::jsonb,lossless_content=${data.lossless},revision=revision+1,updated_by=${actor.userId},updated_at=clock_timestamp() WHERE id::text=${id} RETURNING ${draftColumns}`,
          )
        ).rows;
        return draftJson(row);
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
          return publish(tx, actor, admin, id, rev, visibility, runtime);
        });
      } catch (error) {
        if (classifyDatabaseError(error) === "unique") throw bad("LeetCode ID is already in use");
        throw error;
      }
    },
  };
}
