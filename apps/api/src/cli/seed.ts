/** @file seed.ts @description Append-only catalog fixture installation. @module cli */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { withNodeConnection } from "@quorem/database/core";
import { languageRuntime } from "@quorem/execution";
import {
  parseLosslessJson,
  stringifyLosslessJson,
  validateQuestionPublication,
  validateQuestionSchema,
  type JsonValue,
} from "@quorem/questions";
import { object } from "../adapters/postgres/problems/storage.ts";
import {
  persistQuestionVersion,
  resumeQuestionVersion,
} from "../adapters/postgres/problems/publication.ts";
const list = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const str = (v: JsonValue | undefined): string => {
  if (typeof v !== "string") throw new Error("Invalid fixture");
  return v;
};
async function files(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((p) => p.endsWith(".json"))
    .sort()
    .map((p) => join(dir, p));
}
export async function seedCatalog(pool: Pool, local: boolean, signal?: AbortSignal): Promise<void> {
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 20000, signal }, fn);
  signal?.throwIfAborted();
  if (local)
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 3000 }, async (tx) => {
        await tx.execute(
          sql`INSERT INTO users(id,display_name,participant_id) VALUES ('alice','Alice','00000000-0000-4000-8000-000000000001'),('bob','Bob','00000000-0000-4000-8000-000000000002'),('charlie','Charlie','00000000-0000-4000-8000-000000000003'),('dana','Dana','00000000-0000-4000-8000-000000000004') ON CONFLICT(id) DO NOTHING`,
        );
      }),
    );
  const editorials = new Map<string, JsonValue[]>();
  for (const path of await files(join(root, "fixtures/editorials"))) {
    signal?.throwIfAborted();
    const item = object(parseLosslessJson(await readFile(path, "utf8")));
    editorials.set(str(item.versionId), list(item.solutions));
  }
  const paths = await files(join(root, "fixtures/problems"));
  if (!paths.length) throw new Error("No catalog fixtures");
  for (const path of paths) {
    signal?.throwIfAborted();
    const c = object(parseLosslessJson(await readFile(path, "utf8"))),
      p = object(c.problem),
      slug = str(p.slug),
      versionId = str(p.id),
      version = Number(str(p.version));
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid fixture version");
    c.solutions = editorials.get(versionId) ?? list(c.solutions);
    editorials.delete(versionId);
    const raw = stringifyLosslessJson(c);
    validateQuestionPublication(raw, validateQuestionSchema, languageRuntime);
    signal?.throwIfAborted();
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 3000 }, async (tx) => {
        await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
        await tx.execute(
          sql`INSERT INTO problems(slug) VALUES(${slug}) ON CONFLICT(slug) DO NOTHING`,
        );
        const [problem] = (
          await tx.execute<{ id: string; owner: string | null }>(
            sql`SELECT id::text AS id,owner_id AS owner FROM problems WHERE slug=${slug} FOR UPDATE`,
          )
        ).rows;
        if (!problem || problem.owner !== null) throw new Error("Fixture namespace unavailable");
        const [prior] = (
          await tx.execute<{ problem: string; version: number }>(
            sql`SELECT problem_id::text AS problem,version FROM problem_versions WHERE id=${versionId}::uuid`,
          )
        ).rows;
        if (prior) {
          if (prior.problem !== problem.id || prior.version !== version)
            throw new Error("Fixture version identity conflict");
          await resumeQuestionVersion(tx, raw, versionId, languageRuntime);
        } else
          await persistQuestionVersion(
            tx,
            raw,
            problem.id,
            versionId,
            version,
            null,
            languageRuntime,
          );
      }),
    );
  }
  if (editorials.size) throw new Error("Editorial fixture version not in catalog");
}
