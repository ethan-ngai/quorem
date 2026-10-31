/** @file repository.ts @description Atomic question drafts and immutable publication. @module problems */
import { sql } from "drizzle-orm";
import {
  classifyDatabaseError,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import {
  JsonNumber,
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
function bytes(raw: Uint8Array | null): string | undefined {
  return raw?.length ? new TextDecoder("utf-8", { fatal: true }).decode(raw) : undefined;
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
function fixture(contentValue: Obj): Obj {
  const p = object(contentValue.problem),
    implementations = list(contentValue.implementations).map(object),
    primary = implementations.find((v) => v.language === (p.sql ? "postgresql" : "python"));
  if (!primary) throw bad("primary implementation missing");
  const languages = implementations.map((v) => ({
    language: v.language,
    starterSource: v.starterSource,
    runtimeRevision: v.runtimeRevision,
    harnessRevision: v.harnessRevision,
  }));
  return {
    problem: {
      ...p,
      languages,
      starterSource: primary.starterSource,
      runtimeRevision: primary.runtimeRevision,
    },
    hiddenCases: contentValue.hiddenCases ?? [],
    odysseyHiddenCases: contentValue.odysseyHiddenCases ?? [],
    harnessRevision: primary.harnessRevision,
    referenceSource: primary.referenceSource,
    attribution: contentValue.attribution ?? "",
  };
}
function sidecars(c: Obj): {
  safeFixture: string;
  fixture: Uint8Array | null;
  public: Uint8Array | null;
  stages: Uint8Array | null;
} {
  const f = fixture(c),
    p = object(c.problem),
    o = p.odyssey ? object(p.odyssey) : undefined,
    levels = o ? list(o.levels) : [];
  const pub: Obj = {
    problem: {
      examples: p.examples ?? [],
      ...(levels.length
        ? { odyssey: { levels: [{ examples: object(levels[0]).examples ?? [] }] } }
        : {}),
    },
  };
  const staged: Obj = {
    problem: {
      odyssey: { levels: levels.map((level) => ({ examples: object(level).examples ?? [] })) },
    },
  };
  const whole = store(stringifyLosslessJson(f));
  return {
    safeFixture: whole.safe,
    fixture: whole.lossless,
    public: store(stringifyLosslessJson(pub)).lossless,
    stages: levels.length ? store(stringifyLosslessJson(staged)).lossless : null,
  };
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
  const side = sidecars(c),
    safe = content(side.safeFixture),
    safeProblem = object(safe.problem),
    publicJSON = stringifyLosslessJson(safeProblem);
  await tx.execute(
    sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,lossless_fixture,lossless_public,lossless_stages) SELECT ${versionId}::uuid,${existing.id}::uuid,${next.version},doc->>'title',doc->>'difficulty',doc->>'statementMarkdown',doc->'signature',COALESCE(doc->'constraints','[]'),doc->'limits',${str(c.attribution)},doc->'sql',doc->'odyssey',${side.fixture},${side.public},${side.stages} FROM (SELECT ${publicJSON}::jsonb AS doc) input`,
  );
  for (const item of list(c.implementations)) {
    const v = object(item);
    await tx.execute(
      sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${versionId}::uuid,${str(v.language)},${str(v.starterSource)},${str(v.runtimeRevision)},${str(v.harnessRevision)},${str(v.referenceSource)})`,
    );
  }
  const hidden = stringifyLosslessJson(safe.hiddenCases ?? []),
    staged = stringifyLosslessJson(safe.odysseyHiddenCases ?? []);
  await tx.execute(
    sql`INSERT INTO problem_examples(version_id,ordinal,args,expected,explanation,calls) SELECT ${versionId}::uuid,ordinality-1,value->'args',value->'expected',COALESCE(value->>'explanation',''),COALESCE(value->'calls','[]') FROM jsonb_array_elements(${publicJSON}::jsonb->'examples') WITH ORDINALITY`,
  );
  await tx.execute(
    sql`INSERT INTO problem_test_cases(version_id,ordinal,args,expected,calls) SELECT ${versionId}::uuid,ordinality-1,value->'args',value->'expected',COALESCE(value->'calls','[]') FROM jsonb_array_elements(${hidden}::jsonb) WITH ORDINALITY`,
  );
  await tx.execute(
    sql`INSERT INTO problem_odyssey_cases(version_id,level,ordinal,case_data) SELECT ${versionId}::uuid,stage.ordinality-1,c.ordinality-1,c.value FROM jsonb_array_elements(${staged}::jsonb) WITH ORDINALITY stage(value,ordinality),LATERAL jsonb_array_elements(stage.value) WITH ORDINALITY c(value,ordinality)`,
  );
  await tx.execute(
    sql`INSERT INTO problem_tags(version_id,tag,ordinal) SELECT ${versionId}::uuid,value,ordinality-1 FROM jsonb_array_elements_text(${publicJSON}::jsonb->'tags') WITH ORDINALITY`,
  );
  if (!privateOwner) {
    const leetcode = p.leetcodeId instanceof JsonNumber ? Number(p.leetcodeId.lexeme) : null;
    await tx.execute(
      sql`UPDATE problems SET leetcode_id=${leetcode} WHERE id=${existing.id}::uuid`,
    );
  }
  await tx.execute(sql`DELETE FROM problem_companies WHERE problem_id=${existing.id}::uuid`);
  for (const company of list(p.companies)) {
    const name = str(company);
    await tx.execute(
      sql`INSERT INTO companies(name) VALUES(${name}) ON CONFLICT(lower(name)) DO NOTHING`,
    );
    await tx.execute(
      sql`INSERT INTO problem_companies(problem_id,company_id) SELECT ${existing.id}::uuid,id FROM companies WHERE lower(name)=lower(${name})`,
    );
  }
  for (const item of list(c.solutions)) {
    const v = object(item);
    await tx.execute(
      sql`INSERT INTO problem_solutions(version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes) VALUES(${versionId}::uuid,${str(v.language)},${str(v.source)},${str(v.explanationMarkdown)},${str(v.timeComplexity)},${str(v.spaceComplexity)},${str(v.complexityNotes)})`,
    );
  }
  await tx.execute(
    sql`UPDATE problems SET current_version_id=${versionId}::uuid WHERE id=${existing.id}::uuid`,
  );
  await tx.execute(sql`UPDATE problem_versions SET sealed=true WHERE id=${versionId}::uuid`);
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
  const rows = (
    await tx.execute<{
      owner: string | null;
      data: string;
      lossless: Uint8Array | null;
    }>(sql`SELECT p.owner_id AS owner,v.lossless_fixture AS lossless,jsonb_build_object(
 'problem',jsonb_build_object('id',v.id,'slug',p.slug,'version',v.version::text,'title',v.title,'difficulty',v.difficulty,'statementMarkdown',v.statement_markdown,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,'sql',v.sql_config,'odyssey',v.odyssey,'leetcodeId',p.leetcode_id,
 'tags',COALESCE((SELECT jsonb_agg(tag ORDER BY ordinal) FROM problem_tags WHERE version_id=v.id),'[]'::jsonb),
 'companies',COALESCE((SELECT jsonb_agg(c.name ORDER BY c.name) FROM problem_companies pc JOIN companies c ON c.id=pc.company_id WHERE pc.problem_id=p.id),'[]'::jsonb),
 'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation,'calls',calls) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'::jsonb)),
 'hiddenCases',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'calls',calls) ORDER BY ordinal) FROM problem_test_cases WHERE version_id=v.id),'[]'::jsonb),
 'odysseyHiddenCases',CASE WHEN v.odyssey IS NULL THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(COALESCE((SELECT jsonb_agg(c.case_data ORDER BY c.ordinal) FROM problem_odyssey_cases c WHERE c.version_id=v.id AND c.level=stage.ordinality-1),'[]'::jsonb) ORDER BY stage.ordinality),'[]'::jsonb) FROM jsonb_array_elements(v.odyssey->'levels') WITH ORDINALITY stage(value,ordinality)) END,
 'attribution',v.attribution,
 'implementations',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',language,'starterSource',starter_source,'runtimeRevision',runtime_revision,'harnessRevision',harness_revision,'referenceSource',reference_source) ORDER BY language) FROM problem_languages WHERE version_id=v.id),'[]'::jsonb),
 'solutions',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',language,'source',source,'explanationMarkdown',explanation_markdown,'timeComplexity',time_complexity,'spaceComplexity',space_complexity,'complexityNotes',complexity_notes) ORDER BY language) FROM problem_solutions WHERE version_id=v.id),'[]'::jsonb))::text AS data
 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${id} AND (p.owner_id=${actor.userId} OR (${admin} AND p.owner_id IS NULL))`)
  ).rows;
  if (!rows.length) {
    if (!admin)
      throw new ApplicationError("forbidden", "Only your own private questions can be cloned", 403);
    throw new ApplicationError("not_found", "Problem not found", 404);
  }
  const c = content(rows[0].data),
    p = object(c.problem),
    lossless = bytes(rows[0].lossless);
  if (lossless) {
    const f = content(lossless),
      fp = object(f.problem);
    p.examples = fp.examples ?? [];
    c.hiddenCases = f.hiddenCases ?? [];
    c.odysseyHiddenCases = f.odysseyHiddenCases ?? [];
    if (p.odyssey && fp.odyssey) {
      const target = list(object(p.odyssey).levels),
        source = list(object(fp.odyssey).levels);
      for (let i = 0; i < Math.min(target.length, source.length); i++)
        object(target[i]).examples = object(source[i]).examples ?? [];
    }
  }
  if (
    p.odyssey &&
    list(p.examples).length &&
    stringifyLosslessJson(p.examples) ===
      stringifyLosslessJson(object(list(object(p.odyssey).levels)[0]).examples ?? [])
  )
    p.examples = [];
  return normal(stringifyLosslessJson(c));
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
