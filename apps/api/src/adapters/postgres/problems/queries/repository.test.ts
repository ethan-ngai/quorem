import { describe, expect, it } from "vitest";
import {
  createNodePool,
  withNodeConnection,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { problemQueries } from "./repository.ts";
import { createApp } from "../../../../app.ts";
import { problemRoutes } from "../../../../modules/problems/routes.ts";
import { parseCatalogFilter } from "../../../../modules/problems/queries.ts";

const url = process.env.QUOREM_CATALOG_TEST_DATABASE_URL;
describe.skipIf(!url)("catalog against disposable PostgreSQL", () => {
  it("enforces visibility, redaction, filters, cursors, sidecars and editorial gates", async () => {
    const parsed = new URL(url!);
    expect(parsed.port).toBe("55441");
    expect(parsed.pathname).toBe("/quorem_hono_catalog_test");
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const uid = crypto.randomUUID().slice(0, 8),
      owner = `owner-${uid}`,
      participant = `member-${uid}`,
      other = `other-${uid}`;
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
      versions = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
      match = crypto.randomUUID(),
      historical = crypto.randomUUID();
    const sidecar =
      '{"problem":{"examples":[{"args":["public\\u0000value"],"expected":9007199254740993}],"odyssey":{"levels":[{"examples":[{"args":["stage\\u0000value"],"expected":1}]}]}}}';
    try {
      await pool.query(
        "INSERT INTO users(id,display_name) VALUES($1,'Owner'),($2,'Member'),($3,'Other')",
        [owner, participant, other],
      );
      for (let i = 0; i < 3; i++) {
        await pool.query("INSERT INTO problems(id,slug,owner_id) VALUES($1,$2,$3)", [
          ids[i],
          `${uid}-${i}`,
          i === 1 ? owner : null,
        ]);
        await pool.query(
          `INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,odyssey,lossless_public,lossless_fixture,sql_config) VALUES($1,$2,1,$3,$4,'statement',$5::jsonb,'[]'::jsonb,$6::jsonb,'fixture',$7::jsonb,$8,$9,$10::jsonb)`,
          [
            versions[i],
            ids[i],
            i === 2 ? "Beta" : "Alpha",
            i === 2 ? "hard" : "easy",
            JSON.stringify({
              className: "Solution",
              methodName: "solve",
              parameters: [],
              returnType: "int",
            }),
            JSON.stringify({
              wallTimeMs: 2000,
              memoryBytes: 268435456,
              outputBytes: 65536,
              maxProcesses: 16,
              maxCollectionElements: 10000,
              maxNestingDepth: 100,
            }),
            i === 2
              ? JSON.stringify({
                  levels: [
                    { title: "first", statementMarkdown: "first", methods: [], examples: [] },
                    {
                      title: "SECRET FUTURE",
                      statementMarkdown: "secret",
                      methods: [],
                      examples: [],
                    },
                  ],
                })
              : null,
            i === 2 ? Buffer.from(sidecar) : null,
            Buffer.from("SECRET HIDDEN"),
            i === 0 ? JSON.stringify({ dialect: "postgresql", outputOrder: "ordered" }) : null,
          ],
        );
        await pool.query(
          "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,$2,'starter','runtime','harness','SECRET REFERENCE')",
          [versions[i], i === 0 ? "postgresql" : "python"],
        );
        await pool.query(
          "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,'[1]'::jsonb,'2'::jsonb)",
          [versions[i]],
        );
        await pool.query("INSERT INTO problem_tags(version_id,tag,ordinal) VALUES($1,$2,0)", [
          versions[i],
          i === 2 ? "graphs" : "arrays",
        ]);
        await pool.query("UPDATE problems SET current_version_id=$1 WHERE id=$2", [
          versions[i],
          ids[i],
        ]);
      }
      await pool.query(
        `INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config) SELECT $1,problem_id,2,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config FROM problem_versions WHERE id=$2`,
        [historical, versions[0]],
      );
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'postgresql','old-starter','runtime','harness','SECRET OLD')",
        [historical],
      );
      await pool.query("INSERT INTO companies(name) VALUES($1)", [`${uid}-company`]);
      await pool.query(
        "INSERT INTO problem_companies(problem_id,company_id) SELECT $1,id FROM companies WHERE name=$2",
        [ids[2], `${uid}-company`],
      );
      await pool.query(
        "INSERT INTO problem_solutions(version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes) VALUES($1,'python','SECRET EDITORIAL','explanation','O(n)','O(1)','note')",
        [versions[1]],
      );
      await pool.query(
        "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,problem_version_id,started_at,deadline,difficulties,rules) VALUES($1,$2,$3,now()+interval '1 hour',30,'active',$4,now(),now()+interval '30 minutes',ARRAY['easy'], '{\"hints\":{\"complexity\":true}}'::jsonb)",
        [match, owner, `hash-${uid}`, versions[1]],
      );
      await pool.query(
        "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1),($1,$3,2)",
        [match, owner, participant],
      );
      await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$2)", [
        participant,
        match,
      ]);
      const role = `catalog_${uid}`;
      await pool.query(`CREATE ROLE ${role} LOGIN`);
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      for (const [table, columns] of Object.entries({
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
      }))
        await pool.query(`GRANT SELECT(${columns}) ON ${table} TO ${role}`);
      const readURL = new URL(url!);
      readURL.username = role;
      const limited = createNodePool({
        connectionString: readURL.toString(),
        max: 2,
        connectionTimeoutMs: 2000,
        idleTimeoutMs: 5000,
        onIdleError: () => {},
      });
      try {
        await expect(
          limited.query("SELECT reference_source FROM problem_languages LIMIT 1"),
        ).rejects.toThrow();
        await expect(
          limited.query("SELECT lossless_fixture FROM problem_versions LIMIT 1"),
        ).rejects.toThrow();
        const queries = problemQueries((read) =>
          withNodeConnection(limited, { lifetimeMs: 10000 }, read),
        );
        const captured: SQL[] = [];
        const traced = problemQueries((read) =>
          withNodeConnection(limited, { lifetimeMs: 10000 }, async (scope) =>
            read({
              transaction: (options, action) =>
                scope.transaction(options, async (tx) => {
                  const wrapped = new Proxy(tx, {
                    get(target, key, receiver) {
                      const member = Reflect.get(target, key, receiver);
                      if (key !== "execute" || typeof member !== "function") return member;
                      return (...args: unknown[]) => {
                        captured.push(args[0] as SQL);
                        return Reflect.apply(member, target, args);
                      };
                    },
                  }) as Transaction;
                  return action(wrapped);
                }),
            } as ConnectionScope),
          ),
        );
        await traced.catalog(
          undefined,
          parseCatalogFilter(new URLSearchParams(`q=${uid}&limit=1`)),
        );
        expect(captured).toHaveLength(4);
        const dialect = new PgDialect();
        const plans = [];
        for (const statement of captured) {
          const query = dialect.sqlToQuery(statement);
          const result = await pool.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
            query.params,
          );
          plans.push(result.rows[0]["QUERY PLAN"][0]);
        }
        console.info(
          "catalog EXPLAIN summary",
          JSON.stringify(
            plans.map((p) => ({
              node: p.Plan["Node Type"],
              rows: p.Plan["Actual Rows"],
              planningMs: p["Planning Time"],
              executionMs: p["Execution Time"],
            })),
          ),
        );
        const page = JSON.parse(
          await queries.catalog(
            undefined,
            parseCatalogFilter(new URLSearchParams(`q=${uid}&limit=1`)),
          ),
        );
        expect(page.total).toBe(2);
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBeTruthy();
        const next = JSON.parse(
          await queries.catalog(
            undefined,
            parseCatalogFilter(new URLSearchParams(`q=${uid}&limit=1&cursor=${page.nextCursor}`)),
          ),
        );
        expect(next.items[0].id).not.toBe(page.items[0].id);
        expect(
          JSON.parse(
            await queries.catalog(
              { userId: owner },
              parseCatalogFilter(new URLSearchParams(`q=${uid}&library=private`)),
            ),
          ).total,
        ).toBe(1);
        expect(await queries.byVersion(undefined, historical)).toContain("old-starter");
        expect(await queries.bySlug(undefined, `${uid}-0`)).toContain('"version":"1"');
        expect(await queries.bySlug(undefined, `${uid}-1`)).toBeNull();
        expect(await queries.byVersion(undefined, versions[1])).toBeNull();
        expect(await queries.byVersion({ userId: participant }, versions[1])).toContain(
          '"isPrivate":true',
        );
        expect(await queries.byVersion({ userId: other }, versions[1])).toBeNull();
        const anonymous = createApp({ allowedOrigins: [], requestId: () => "test" }).route(
          "/",
          problemRoutes({ queries, identify: async () => undefined }),
        );
        expect(
          (
            await anonymous.request(`/v1/problem-versions/${versions[1]}`, {
              headers: { "X-Quorem-Owner": owner, "X-Dev-User": owner },
            })
          ).status,
        ).toBe(404);
        const member = createApp({ allowedOrigins: [], requestId: () => "test" }).route(
          "/",
          problemRoutes({
            queries,
            identify: async () => ({
              kind: "local",
              userId: participant,
              displayName: "member",
              admin: false,
              emailVerified: true,
              sessionId: "test",
              strongUntil: 0,
            }),
          }),
        );
        expect((await member.request(`/v1/problem-versions/${versions[1]}`)).status).toBe(200);

        const visible = await queries.byVersion(undefined, versions[2]);
        expect(visible).not.toContain("SECRET");
        expect(visible).toContain("\\u0000");
        expect(visible).toContain("9007199254740993");
        expect(JSON.parse(visible!).odyssey.levels).toHaveLength(1);
        await expect(
          queries.editorials({ userId: participant }, versions[1], false),
        ).rejects.toMatchObject({ status: 403 });
        const complexity = await queries.editorials({ userId: participant }, versions[1], true);
        expect(complexity).toContain("O(n)");
        expect(complexity).not.toContain("SECRET EDITORIAL");
        for (const [param, want] of [
          ["type=odyssey", 1],
          ["sql=true", 1],
          ["sql=false", 1],
          ["difficulty=hard", 1],
          ["topic=graphs", 1],
          [`company=${uid}-company`, 1],
        ] as const) {
          const result = JSON.parse(
            await queries.catalog(
              undefined,
              parseCatalogFilter(new URLSearchParams(`q=${uid}&${param}`)),
            ),
          );
          expect(result.total, param).toBe(want);
        }
        const descending = JSON.parse(
          await queries.catalog(
            undefined,
            parseCatalogFilter(new URLSearchParams(`q=${uid}&sort=difficulty&order=desc`)),
          ),
        );
        expect(descending.items[0].difficulty).toBe("hard");
        const pageTwo = JSON.parse(
          await queries.catalog(
            undefined,
            parseCatalogFilter(new URLSearchParams(`q=${uid}&limit=1&page=2`)),
          ),
        );
        expect(pageTwo.items[0].id).toBe(next.items[0].id);
        const sqlCandidates = await queries.candidates(
          { userId: owner },
          { difficulty: "easy", topic: "arrays", company: "", type: "classic", sql: "true" },
        );
        expect(sqlCandidates.some((c) => c.id === versions[0] && c.sql)).toBe(true);
        const chosen = await queries.candidates(
          { userId: owner },
          {
            selectedVersionId: versions[1],
            difficulty: "hard",
            topic: "missing",
            company: "",
            type: "odyssey",
            sql: "true",
          },
        );
        expect(chosen).toEqual([{ id: versions[1], sql: false }]);
        const candidates = await queries.candidates(
          { userId: owner },
          { difficulty: "easy", topic: "arrays", company: "", type: "classic", sql: "false" },
        );
        expect(candidates.some((c) => c.id === versions[1])).toBe(true);
        let resume!: () => void;
        let ready!: () => void;
        const paused = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const entered = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const raced = problemQueries((read) =>
          withNodeConnection(limited, { lifetimeMs: 10000 }, async (scope) =>
            read({
              transaction: (options, action) =>
                scope.transaction(options, async (tx) => {
                  ready();
                  await paused;
                  return action(tx);
                }),
            } as ConnectionScope),
          ),
        );
        const inFlight = raced.byVersion({ userId: participant }, versions[1]);
        await entered;
        await pool.query(
          "UPDATE match_participants SET forfeited=true WHERE match_id=$1 AND owner_id=$2",
          [match, participant],
        );
        resume();
        expect(await inFlight).not.toBeNull();
        expect(await queries.byVersion({ userId: participant }, versions[1])).toBeNull();
        let unblock!: () => void;
        let began!: () => void;
        const waiting = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        const opened = new Promise<void>((resolve) => {
          began = resolve;
        });
        const bounded = problemQueries((read) =>
          withNodeConnection(limited, { lifetimeMs: 50 }, async (scope) => {
            began();
            await waiting;
            return read(scope);
          }),
        );
        const deadline = bounded.bySlug(undefined, `${uid}-0`);
        await opened;
        await expect(deadline).rejects.toMatchObject({ kind: "aborted" });
        unblock();

        await pool.query("UPDATE problems SET owner_id=$1 WHERE id=$2", [other, ids[1]]);
        expect(await queries.byVersion({ userId: owner }, versions[1])).not.toBeNull();
        await pool.query("UPDATE matches SET state='completed',outcome='{}'::jsonb WHERE id=$1", [
          match,
        ]);
        expect(await queries.byVersion({ userId: owner }, versions[1])).toBeNull();
        expect(await queries.byVersion({ userId: other }, versions[1])).not.toBeNull();
        await pool.query(
          "INSERT INTO users(id,display_name) VALUES('','Empty') ON CONFLICT DO NOTHING",
        );
        await pool.query("UPDATE problems SET owner_id='' WHERE id=$1", [ids[1]]);
        expect(await queries.byVersion(undefined, versions[1])).toBeNull();

        await pool.query("UPDATE problems SET current_version_id=NULL WHERE id=$1", [ids[2]]);
        expect(await queries.bySlug(undefined, `${uid}-2`)).toBeNull();
        expect(await queries.byVersion(undefined, versions[2])).not.toBeNull();
        await pool.query(`REVOKE SELECT(lossless_public) ON problem_versions FROM ${role}`);
        const unavailable = await anonymous.request(`/v1/problems/${uid}-0`);
        expect(unavailable.status).toBe(503);
        const failure = await unavailable.text();
        expect(failure).toContain("temporarily_unavailable");
        expect(failure).not.toContain("permission denied");
      } finally {
        await limited.end();
        await pool.query(`DROP OWNED BY ${role}`);
        await pool.query(`DROP ROLE ${role}`);
      }
    } finally {
      await pool.end();
    }
  });
});
