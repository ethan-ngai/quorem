/** @file seed-question.ts @description Trusted operator question import and replay. @module cli */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { withNodeConnection } from "@quorem/database/core";
import { languageRuntime } from "@quorem/execution";
import {
  normalizeQuestionDraft,
  parseLosslessJson,
  stringifyLosslessJson,
  validateQuestionPublication,
  validateQuestionSchema,
  JsonNumber,
  type JsonValue,
} from "@quorem/questions";
import { canonicalCaseValue } from "../adapters/postgres/problems/case-literals.ts";
import { seedFingerprint } from "./seed-fingerprint.ts";
import {
  operatorQuestionAuthoring,
  preservePublishedOperatorSeed,
} from "../adapters/postgres/problems/authoring/repository.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Obj = { [key: string]: JsonValue };
function object(value: JsonValue | undefined): Obj {
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw new Error("Invalid question");
  return value;
}

function key(raw: string, actor: string): { fingerprint: string; slug: string } {
  const c = object(parseLosslessJson(normalizeQuestionDraft(raw))),
    p = object(c.problem);
  p.id = "";
  p.version = "";
  if (typeof p.slug !== "string") throw new Error("Invalid slug");
  const prefix = `private-${hash(actor).slice(0, 16)}-`;
  if (p.slug.startsWith(prefix)) p.slug = p.slug.slice(prefix.length);
  for (const field of ["implementations", "solutions"]) {
    const rows = c[field];
    if (Array.isArray(rows)) {
      for (const row of rows) if (field === "implementations") object(row).starterSource = "";
      rows.sort((a, b) => {
        const x = object(a).language,
          y = object(b).language;
        if (typeof x !== "string" || typeof y !== "string") throw new Error("Invalid language");
        return x < y ? -1 : x > y ? 1 : 0;
      });
    }
  }
  return { slug: p.slug, fingerprint: hash(stringifyLosslessJson(canonicalCaseValue(c))) };
}
export async function seedQuestion(
  pool: Pool,
  actor: string,
  visibility: "global" | "private",
  path: string,
): Promise<string> {
  const original = await readFile(path, "utf8");
  const raw = normalizeQuestionDraft(original);
  validateQuestionPublication(raw, validateQuestionSchema, languageRuntime);
  const input = key(raw, actor),
    prefix = `seed:question:${actor}:${visibility}:`,
    operation = prefix + seedFingerprint(original, actor).fingerprint;
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,740179))", [operation]);
    locked = true;
    const privateSlug = `private-${hash(actor).slice(0, 16)}-${input.slug}`;
    const rows = (
      await client.query<{ scope: string; content: string }>(
        `SELECT a.scope,convert_from(COALESCE(d.lossless_content,convert_to(d.content::text,'UTF8')),'UTF8') AS content FROM access_audit a JOIN question_drafts d ON d.id::text=a.scope WHERE a.actor=$1 AND a.action='questions.seed' AND left(a.operation_id,length($2))=$2 AND d.content->'problem'->>'slug' IN ($3,$4) AND (d.published_version_id IS NULL OR EXISTS(SELECT 1 FROM problems p WHERE p.current_version_id=d.published_version_id)) ORDER BY (d.published_version_id IS NULL),a.occurred_at,a.operation_id`,
        [actor, prefix, input.slug, privateSlug],
      )
    ).rows;
    let id = rows.find((row) => key(row.content, actor).fingerprint === input.fingerprint)?.scope;
    const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
    const repository = operatorQuestionAuthoring(run, languageRuntime, original),
      operator = { userId: actor, admin: true, globalAllowed: true };
    if (!id) {
      const draft = JSON.parse(await repository.create(operator, raw, undefined)) as { id: string };
      id = draft.id;
      await client.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'questions.seed',$3,'Deployment question import')",
        [`${operation}:${id}`, actor, id],
      );
    }
    const draft = JSON.parse(await repository.get(operator, id)) as {
      revision: string;
      publishedVersionId?: string;
    };
    if (draft.publishedVersionId) {
      await preservePublishedOperatorSeed(run, operator, id, original);
      return draft.publishedVersionId;
    }
    const refreshed = JSON.parse(await repository.update(operator, id, draft.revision, raw)) as {
      revision: string;
    };
    return (
      JSON.parse(await repository.publish(operator, id, refreshed.revision, visibility)) as {
        publishedVersionId: string;
      }
    ).publishedVersionId;
  } finally {
    let destroy = false;
    if (locked)
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,740179))", [operation]);
      } catch {
        destroy = true;
      }
    client.release(destroy);
  }
}
