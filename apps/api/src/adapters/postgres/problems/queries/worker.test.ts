/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";

const url = (env as unknown as { CATALOG_TEST_DATABASE_URL: string }).CATALOG_TEST_DATABASE_URL;
const opts = { connectionTimeoutMs: 1000, lifetimeMs: 5000 };
const txopts = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };
const user = "quorem-catalog-worker-actor",
  role = "quorem_catalog_worker_read";
let problem: string, version: string, slug: string;
const run = <T>(f: (scope: ConnectionScope) => Promise<T>) => withWorkerConnection(url, opts, f);

describe.skipIf(!url)("workerd catalog against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url);
    if (
      parsed.pathname !== "/quorem_hono_catalog_test" ||
      !["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
      throw new Error("disposable catalog database required");
    problem = crypto.randomUUID();
    version = crypto.randomUUID();
    slug = `worker-${crypto.randomUUID().slice(0, 8)}`;
    await run((scope) =>
      scope.transaction(txopts, async (tx) => {
        await tx.execute(
          sql.raw(
            `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN; END IF; END $$`,
          ),
        );
        await tx.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${role}`));
        const grants: Record<string, string> = {
          users: "id,display_name,role,disabled",
          problems: "id,slug,current_version_id,owner_id,leetcode_id",
          problem_versions:
            "id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,sql_config,odyssey,lossless_public",
          problem_languages: "version_id,language,starter_source,runtime_revision,harness_revision",
          problem_examples: "version_id,ordinal,args,expected,explanation,calls",
          problem_tags: "version_id,tag,ordinal",
          problem_solutions:
            "version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes",
          companies: "id,name",
          problem_companies: "problem_id,company_id",
          matches: "id,problem_version_id,state,rules",
          match_participants: "match_id,owner_id,forfeited",
          match_reservations: "match_id,owner_id",
        };
        for (const [table, columns] of Object.entries(grants))
          await tx.execute(sql.raw(`GRANT SELECT(${columns}) ON ${table} TO ${role}`));
        await tx.execute(
          sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker actor') ON CONFLICT(id) DO UPDATE SET disabled=false`,
        );
        await tx.execute(
          sql`INSERT INTO problems(id,slug,owner_id) VALUES(${problem},${slug},${user})`,
        );
        await tx.execute(
          sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture,lossless_public) VALUES(${version},${problem},1,'Worker private','easy','statement',${JSON.stringify({ className: "Solution", methodName: "solve", parameters: [], returnType: "int" })}::jsonb,'[]'::jsonb,${JSON.stringify({ wallTimeMs: 2000, memoryBytes: 268435456, outputBytes: 65536, maxProcesses: 16, maxCollectionElements: 10000, maxNestingDepth: 100 })}::jsonb,'fixture',convert_to('SECRET HIDDEN','UTF8'),convert_to('{"problem":{"examples":[{"args":["public\\u0000value"],"expected":9007199254740993}]}}','UTF8'))`,
        );
        await tx.execute(
          sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version},'python','starter','runtime','harness','SECRET REFERENCE')`,
        );
        await tx.execute(
          sql`UPDATE problems SET current_version_id=${version} WHERE id=${problem}`,
        );
      }),
    );
  });
  afterAll(async () => {
    if (!url) return;
    await run((scope) =>
      scope.transaction(txopts, async (tx) => {
        await tx.execute(sql.raw(`DROP OWNED BY ${role}`));
        await tx.execute(sql.raw(`DROP ROLE ${role}`));
      }),
    );
  });
  it("reads safe projections with real identity before acquiring the bounded query connection", async () => {
    const response = await SELF.fetch(`http://localhost/v1/problems?q=${slug}`, {
      headers: { "X-Dev-User": "spoofed", "X-Quorem-Owner": "spoofed" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Fixture-Identity-First")).toBe("true");
    expect(response.headers.get("X-Fixture-Queries")).toBe("4");
    const text = await response.text();
    expect(text).toContain(slug);
    expect(text).toContain("\\u0000");
    expect(text).toContain("9007199254740993");
    expect(text).not.toContain("SECRET");
    const pid = Number(response.headers.get("X-Fixture-Pid"));
    expect(pid).toBeGreaterThan(0);
    const active = await run((scope) =>
      scope.transaction(
        { ...txopts, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ n: number }>(
              sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=${pid}`,
            )
          ).rows[0].n,
      ),
    );
    expect(active).toBe(0);
    const detail = await SELF.fetch(`http://localhost/v1/problem-versions/${version}`);
    expect(detail.status).toBe(200);
    expect(detail.headers.get("X-Fixture-Queries")).toBe("1");
  });
  it("denies private columns and rejects a revoked live identity before opening the catalog scope", async () => {
    const restricted = new URL(url);
    restricted.username = role;
    await expect(
      withWorkerConnection(restricted.toString(), opts, (scope) =>
        scope.transaction({ ...txopts, readOnly: true }, async (tx) => {
          await tx.execute(sql`SELECT reference_source FROM problem_languages LIMIT 1`);
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withWorkerConnection(restricted.toString(), opts, (scope) =>
        scope.transaction({ ...txopts, readOnly: true }, async (tx) => {
          await tx.execute(sql`SELECT lossless_fixture FROM problem_versions LIMIT 1`);
        }),
      ),
    ).rejects.toThrow();
    await run((scope) =>
      scope.transaction(txopts, async (tx) => {
        await tx.execute(sql`UPDATE users SET disabled=true WHERE id=${user}`);
      }),
    );
    const response = await SELF.fetch(`http://localhost/v1/problem-versions/${version}`);
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Fixture-Queries")).toBe("0");
    expect(response.headers.get("X-Fixture-Pid")).toBe("0");
  });
});
