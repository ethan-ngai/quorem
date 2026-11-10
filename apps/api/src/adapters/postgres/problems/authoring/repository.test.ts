import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { authoringRoutes } from "../../../../modules/problems/authoring/routes.ts";
import { questionAuthoring } from "./repository.ts";
import { parseCatalogFilter } from "../../../../modules/problems/queries.ts";
import { problemQueries } from "../queries/repository.ts";
const url = process.env.QUOREM_AUTHORING_TEST_DATABASE_URL;
const runtime = (language: string) =>
  (
    {
      python: { revision: "python-3.12-v1", harness: "quorem-harness-v2" },
      postgresql: { revision: "postgresql-17.6-v1", harness: "quorem-postgresql-v2" },
      java: { revision: "java-21.0.9-v1", harness: "quorem-java-v1" },
      typescript: { revision: "typescript-5.9.3-node-22.21.1-v1", harness: "quorem-typescript-v1" },
      ocaml: { revision: "ocaml-4.13.1-v1", harness: "quorem-ocaml-v1" },
    } as Record<string, { revision: string; harness: string }>
  )[language];
describe.skipIf(!url)("authoring on disposable PostgreSQL", () => {
  it("preserves retained versions while rejecting new version identities", async () => {
    assertRunnerFixture(url!, ["/quorem_hono_authoring_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const client = await pool.connect();
    const problem = crypto.randomUUID(),
      current = crypto.randomUUID(),
      archived = crypto.randomUUID();
    const insert = `INSERT INTO question_publications(id,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sealed)
      VALUES($1,$2,'Fixture','easy','statement','{}','[]','{}','fixture',true)`;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [
        problem,
        `archive-${problem}`,
      ]);
      await client.query(insert, [current, problem]);
      await client.query("UPDATE problems SET current_publication_id=$1 WHERE id=$2", [
        current,
        problem,
      ]);
      // Model rows retained from a database upgraded before the insert guard.
      await client.query("SET LOCAL session_replication_role=replica");
      await client.query(insert, [archived, problem]);
      await client.query("SET LOCAL session_replication_role=origin");
      await client.query("SAVEPOINT rejected_version");
      await expect(client.query(insert, [crypto.randomUUID(), problem])).rejects.toMatchObject({
        code: "23505",
      });
      await client.query("ROLLBACK TO SAVEPOINT rejected_version");
      await client.query("SET CONSTRAINTS current_publication_identity DEFERRED");
      await client.query(
        "SELECT set_config('quorem.question_mutation',$1,true),set_config('quorem.question_replacement',$1,true)",
        [current],
      );
      await client.query("DELETE FROM question_publications WHERE id=$1", [current]);
      await client.query(insert, [current, problem]);
      expect(
        (
          await client.query(
            "SELECT id::text FROM question_publications WHERE problem_id=$1 ORDER BY id",
            [problem],
          )
        ).rows.map((r) => r.id),
      ).toEqual([archived, current].sort());
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });
  it("publishes generated graph inputs and keeps private graph metadata private", async () => {
    assertRunnerFixture(url!, ["/quorem_hono_authoring_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const owner = `graph-author-${crypto.randomUUID()}`;
    const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
    const repository = questionAuthoring(run, runtime);
    try {
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES($1,'Graph author','admin')",
        [owner],
      );
      const content = JSON.parse(
        readFileSync(
          new URL("../../../../../../../fixtures/problems/run-widths.json", import.meta.url),
          "utf8",
        ),
      );
      const graph = {
        directed: true,
        nodes: [{ id: 0, value: "start" }, 1],
        edges: [{ from: 0, to: 1 }],
      };
      const privateGraph = {
        directed: true,
        nodes: [0, { id: 1, value: "private" }],
        edges: [{ from: 1, to: 0 }],
      };
      content.problem.slug = `graph-fixture-${crypto.randomUUID().slice(0, 8)}`;
      content.problem.signature.graphEncodings = {
        values: { kind: "successor", nodeValueType: "str" },
      };
      content.problem.examples = [{ args: [], expected: [1, 1], graphs: { values: graph } }];
      content.hiddenCases = [{ args: [], expected: [1, 1], graphs: { values: privateGraph } }];
      const actor = { userId: owner, admin: true, globalAllowed: true };
      const draft = JSON.parse(await repository.create(actor, JSON.stringify(content), undefined));
      const published = JSON.parse(await repository.publish(actor, draft.id, "1", "global"));
      const version = published.publishedVersionId;
      const publicProblem = JSON.parse(
        (await problemQueries(run).byPublication(undefined, version))!,
      );
      expect(publicProblem.examples).toEqual([
        { args: [[1, -1]], expected: [1, 1], graphs: { values: graph } },
      ]);
      expect(publicProblem.hiddenCases).toBeUndefined();
      const rows = await pool.query(
        "SELECT args,graphs FROM problem_test_cases WHERE publication_id=$1",
        [version],
      );
      expect(rows.rows).toEqual([{ args: [[-1, 0]], graphs: { values: privateGraph } }]);
      const runner = await pool.query(
        `SELECT convert_from(b.data,'UTF8')::jsonb AS data
        FROM runner_publication_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash
        WHERE c.publication_id=$1 AND c.channel='hidden'`,
        [version],
      );
      expect(runner.rows).toEqual([{ data: { args: [[-1, 0]], expected: [1, 1] } }]);
    } finally {
      await pool.end();
    }
  });
  it("publishes atomically, fences revisions and protects owner content", async () => {
    assertRunnerFixture(url!, ["/quorem_hono_authoring_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 6,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const owner = `author-${crypto.randomUUID()}`,
      other = `other-${crypto.randomUUID()}`,
      admin = `admin-${crypto.randomUUID()}`;
    try {
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES($1,'Owner','user'),($2,'Other','user'),($3,'Admin','admin')",
        [owner, other, admin],
      );
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'questions.custom','manual','fixture','fixture','test'),($3,$4,'questions.custom','manual','fixture2','fixture','test')",
        [crypto.randomUUID(), owner, crypto.randomUUID(), other],
      );
      const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
      const repository = questionAuthoring(run, runtime),
        catalog = problemQueries(run);
      const content = readFileSync(
        new URL("../../../../../../../fixtures/problems/run-widths.json", import.meta.url),
        "utf8",
      );
      const parsedContent = JSON.parse(content);
      parsedContent.approaches.push({
        id: "grouping",
        title: "Grouping",
        defaultLanguage: "python",
        explanationMarkdown: "Group adjacent equal values.",
        timeComplexity: "O(n)",
        spaceComplexity: "O(n)",
        complexityNotes: "Materializes one run at a time.",
        implementations: [
          {
            language: "python",
            source:
              "from itertools import groupby\nclass Solution:\n def runWidths(self, values): return [len(list(group)) for _, group in groupby(values)]\n",
          },
        ],
      });
      parsedContent.problem.slug = `fixture-${crypto.randomUUID().slice(0, 8)}`;
      const raw = JSON.stringify(parsedContent).replace('"expected":[999]', '"expected":[999]');
      const http = createApp({ allowedOrigins: [], requestId: () => "http-test" }).route(
        "/",
        authoringRoutes({
          identify: async () => ({
            kind: "local",
            userId: owner,
            displayName: "Owner",
            admin: false,
            emailVerified: true,
            sessionId: "test",
            strongUntil: 0,
          }),
          authoring: repository,
          allowLocalStrongBypass: false,
          now: () => 100,
        }),
      );
      const createResponse = await http.request("/v1/admin/question-drafts", {
        method: "POST",
        body: '{"content":{"problem":{},"hiddenCases":[],"attribution":"","approaches":[],"canonicalApproachId":""}}',
      });
      expect(createResponse.status).toBe(201);
      const empty = (await createResponse.json()) as { id: string; revision: string };
      expect(empty.revision).toBe("1");
      expect(
        (
          await http.request(`/v1/admin/question-drafts/${empty.id}`, {
            method: "PUT",
            body: '{"revision":"1","content":{"problem":{}}}',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await http.request(`/v1/admin/question-drafts/${empty.id}/publish`, {
            method: "POST",
            body: '{"revision":"2","visibility":"private"}',
          })
        ).status,
      ).toBe(400);
      const actor = { userId: owner, admin: false, globalAllowed: false };
      const draft = JSON.parse(await repository.create(actor, raw, undefined));
      expect(draft.revision).toBe("1");
      expect(JSON.parse(await repository.list(actor)).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: empty.id, ready: false }),
          expect.objectContaining({ id: draft.id, ready: true, isSql: false, fromLeetCode: false }),
        ]),
      );
      await expect(repository.get({ userId: other, admin: false }, draft.id)).rejects.toMatchObject(
        { status: 404 },
      );
      const readyDrafts = await http.request("/v1/admin/question-drafts?readiness=ready");
      expect(readyDrafts.status).toBe(200);
      expect((await readyDrafts.json()).items.map((item: { id: string }) => item.id)).toEqual([
        draft.id,
      ]);
      const firstPage = await (
        await http.request("/v1/admin/question-drafts?limit=1&sort=title&order=asc")
      ).json();
      const secondPage = await (
        await http.request("/v1/admin/question-drafts?limit=1&page=2&sort=title&order=asc")
      ).json();
      expect(firstPage).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect(secondPage).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(firstPage.items[0].id).not.toBe(secondPage.items[0].id);
      const readyPage = await (
        await http.request(
          "/v1/admin/question-drafts?readiness=ready&limit=1&sort=difficulty&order=desc",
        )
      ).json();
      expect(readyPage).toMatchObject({ total: 1, items: [{ id: draft.id }] });
      expect((await http.request("/v1/admin/question-drafts?limit=0")).status).toBe(400);
      expect((await http.request("/v1/admin/question-publications?sort=updatedAt")).status).toBe(
        400,
      );
      const unmatched = await http.request("/v1/admin/question-drafts?sql=true");
      expect((await unmatched.json()).items).toEqual([]);
      const updated = JSON.parse(await repository.update(actor, draft.id, "1", raw));
      expect(updated.revision).toBe("2");
      await expect(repository.update(actor, draft.id, "1", raw)).rejects.toMatchObject({
        code: "revision_conflict",
      });
      const published = JSON.parse(await repository.publish(actor, draft.id, "2", "private"));
      expect(published.revision).toBe("3");
      expect(published.publishedVersionId).toBeTruthy();
      const available = JSON.parse(
        (await catalog.byPublication({ userId: owner }, published.publishedVersionId))!,
      );
      expect(available.languages.map((item: { language: string }) => item.language).sort()).toEqual(
        ["java", "ocaml", "python", "typescript"],
      );
      expect(available.starterSource).toContain(
        "def runWidths(self, values: list[int]) -> list[int]:",
      );
      expect(JSON.parse(await repository.publications(actor)).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: published.publishedVersionId,
            isPrivate: true,
            isSql: false,
          }),
        ]),
      );
      const publicationsPage = await (
        await http.request(
          "/v1/admin/question-publications?limit=1&sort=difficulty&order=desc&page=2",
        )
      ).json();
      expect(publicationsPage).toMatchObject({ items: [], total: 1, page: 2, limit: 1 });
      expect(
        await catalog.byPublication({ userId: owner }, published.publishedVersionId),
      ).toContain("class Solution");
      expect(await catalog.byPublication(undefined, published.publishedVersionId)).toBeNull();
      await expect(repository.publish(actor, draft.id, "2", "private")).rejects.toMatchObject({
        code: "revision_conflict",
      });
      const fork = JSON.parse(
        await repository.create(actor, undefined, published.publishedVersionId),
      );
      expect(fork.content.hiddenCases).toHaveLength(parsedContent.hiddenCases.length);
      expect(fork.content.canonicalApproachId).toBe(parsedContent.canonicalApproachId);
      expect(fork.content.approaches).toEqual(parsedContent.approaches);
      expect(fork.content).not.toHaveProperty("implementations");
      expect(
        JSON.parse(await catalog.editorials({ userId: owner }, published.publishedVersionId, false))
          .items,
      ).toEqual(expect.arrayContaining(parsedContent.approaches));
      const complexity = await catalog.editorials(
        { userId: owner },
        published.publishedVersionId,
        true,
      );
      expect(JSON.parse(complexity).items.map((item: { id: string }) => item.id)).toEqual([
        "default",
        "grouping",
      ]);
      expect(complexity).not.toContain("implementations");
      expect(complexity).not.toContain("explanationMarkdown");

      const nul = structuredClone(parsedContent);
      nul.problem.slug = `nul-${crypto.randomUUID().slice(0, 8)}`;
      nul.problem.signature = {
        className: "Solution",
        methodName: "echo",
        parameters: [{ name: "x", type: "str" }],
        returnType: "str",
      };
      nul.problem.constraints = [];
      nul.problem.examples = [{ args: ["visible\u0000text"], expected: "visible\u0000text" }];
      nul.hiddenCases = [{ args: ["SECRET\u0000HIDDEN"], expected: "SECRET\u0000HIDDEN" }];
      const nd = JSON.parse(await repository.create(actor, JSON.stringify(nul), undefined));
      const np = JSON.parse(await repository.publish(actor, nd.id, "1", "private"));
      const side = await pool.query(
        "SELECT lossless_fixture,lossless_public FROM question_publications WHERE id=$1",
        [np.publishedVersionId],
      );
      expect(side.rows[0].lossless_fixture).not.toBeNull();
      expect(side.rows[0].lossless_public.toString()).not.toContain("SECRET");
      const publicView = await catalog.byPublication({ userId: owner }, np.publishedVersionId);
      expect(publicView).toContain("\\u0000");
      expect(publicView).not.toContain("SECRET");
      const cloned = JSON.parse(await repository.create(actor, undefined, np.publishedVersionId));
      expect(cloned.content.hiddenCases[0].args[0]).toBe("SECRET\u0000HIDDEN");
      await expect(
        repository.create({ userId: other, admin: false }, undefined, np.publishedVersionId),
      ).rejects.toMatchObject({ status: 404 });
      const sq = structuredClone(parsedContent);
      sq.problem.slug = `sql-${crypto.randomUUID().slice(0, 8)}`;
      sq.problem.sql = {
        dialect: "postgresql",
        outputOrder: "ordered",
        tables: [{ name: "t", columns: [{ name: "n", type: "numeric" }] }],
        output: [{ name: "n", type: "numeric" }],
      };
      sq.problem.constraints = [];
      sq.problem.examples = [
        {
          args: [{ tables: [{ name: "t", rows: [[1]] }] }],
          expected: { rows: [[{ $numeric: "1" }]] },
        },
      ];
      sq.hiddenCases = structuredClone(sq.problem.examples);
      sq.approaches = [
        {
          ...sq.approaches[0],
          defaultLanguage: "postgresql",
          implementations: [{ language: "postgresql", source: "select 1" }],
        },
      ];
      const sqlRaw = JSON.stringify(sq).replaceAll('"rows":[[1]]', '"rows":[[1e309]]');
      const rawSqlDraft = await repository.create(actor, sqlRaw, undefined);
      expect(rawSqlDraft).toContain("1e309");
      const sd = JSON.parse(rawSqlDraft);
      expect(sd.content.problem.examples[0].args[0].tables[0].rows[0][0]).toBe(Infinity);
      const rawSqlPublished = await repository.publish(actor, sd.id, "1", "private");
      expect(rawSqlPublished).toContain("1e309");
      const sp = JSON.parse(rawSqlPublished);
      expect(await catalog.byPublication({ userId: owner }, sp.publishedVersionId)).toContain(
        "1e309",
      );
      expect(await repository.create(actor, undefined, sp.publishedVersionId)).toContain("1e309");
      const stored = await pool.query(
        "SELECT args::text FROM problem_test_cases WHERE publication_id=$1",
        [sp.publishedVersionId],
      );
      expect(stored.rows[0].args).toContain("1000000000000000000000000000000000000000");

      const staged = JSON.parse(
        readFileSync(
          new URL("../../../../../../../fixtures/odyssey/balance-ledger.json", import.meta.url),
          "utf8",
        ),
      );
      staged.problem.slug = `staged-${crypto.randomUUID().slice(0, 8)}`;
      const od = JSON.parse(await repository.create(actor, JSON.stringify(staged), undefined));
      const op = JSON.parse(await repository.publish(actor, od.id, "1", "private"));
      const stageView = JSON.parse(
        (await catalog.byPublication({ userId: owner }, op.publishedVersionId))!,
      );
      expect(stageView.odyssey.levels).toHaveLength(1);
      const stageFork = JSON.parse(
        await repository.create(actor, undefined, op.publishedVersionId),
      );
      expect(stageFork.content.problem.odyssey.levels).toHaveLength(2);
      expect(
        stageFork.content.problem.odyssey.levels.every(
          (level: { hiddenCases: unknown[] }) => level.hiddenCases.length,
        ),
      ).toBe(true);
      const stagedSql = structuredClone(sq);
      stagedSql.problem.slug = `sqlstage-${crypto.randomUUID().slice(0, 8)}`;
      stagedSql.problem.odyssey = {
        levels: [
          {
            title: "First",
            statementMarkdown: "Query items",
            methods: [],
            examples: stagedSql.problem.examples,
            hiddenCases: stagedSql.hiddenCases,
          },
        ],
      };
      stagedSql.problem.examples = [];
      stagedSql.hiddenCases = [];
      const osd = JSON.parse(await repository.create(actor, JSON.stringify(stagedSql), undefined));
      const osp = JSON.parse(await repository.publish(actor, osd.id, "1", "private"));
      const sqlFork = JSON.parse(await repository.create(actor, undefined, osp.publishedVersionId));
      expect(sqlFork.content.problem.odyssey.levels[0].hiddenCases).toHaveLength(1);
      const batchDrafts = await Promise.all(
        Array.from({ length: 3 }, (_, i) => {
          const item = structuredClone(parsedContent);
          item.problem.slug = `batch-${crypto.randomUUID().slice(0, 8)}-${i}`;
          return repository.create(actor, JSON.stringify(item), undefined).then(JSON.parse);
        }),
      );
      const batchPublish = await http.request("/v1/admin/question-drafts/publish-batch", {
        method: "POST",
        body: JSON.stringify({
          items: batchDrafts.map((d, i) => ({
            id: d.id,
            revision: i === 1 ? "999" : d.revision,
            visibility: "private",
          })),
        }),
      });
      expect(batchPublish.status).toBe(200);
      expect((await batchPublish.json()).items.map((i: { status: string }) => i.status)).toEqual([
        "succeeded",
        "failed",
        "succeeded",
      ]);
      expect(JSON.parse(await repository.get(actor, batchDrafts[1].id)).revision).toBe("1");
      const publishedBatch = await Promise.all(
        [batchDrafts[0], batchDrafts[2]].map((d) => repository.get(actor, d.id).then(JSON.parse)),
      );
      const currentPublication = publishedBatch[1].publishedVersionId;
      const deleteBatch = (user: typeof actor, items: { id: string; current: boolean }[]) =>
        repository.mutateBatch(user, { action: "delete-publications", items }).then(JSON.parse);
      expect(
        (
          await deleteBatch({ ...actor, userId: other }, [
            { id: currentPublication, current: true },
          ])
        ).items[0],
      ).toMatchObject({ status: "failed", code: "not_found" });
      const batchWorkspace = crypto.randomUUID();
      const batchSubmission = crypto.randomUUID();
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,publication_id,language) VALUES($1,$2,$3,'python')",
        [batchWorkspace, owner, currentPublication],
      );
      await pool.query(
        "INSERT INTO submissions(id,workspace_id,owner_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','pass','hash','queued','[]')",
        [batchSubmission, batchWorkspace, owner],
      );
      expect(
        (await deleteBatch(actor, [{ id: currentPublication, current: true }])).items[0],
      ).toMatchObject({ status: "failed", code: "revision_conflict" });
      await pool.query("DELETE FROM submissions WHERE id=$1", [batchSubmission]);
      const deletedBatch = await deleteBatch(actor, [
        { id: crypto.randomUUID(), current: false },
        { id: publishedBatch[0].publishedVersionId, current: false },
        { id: currentPublication, current: true },
      ]);
      expect(deletedBatch.items.map((i: { status: string }) => i.status)).toEqual([
        "failed",
        "succeeded",
        "succeeded",
      ]);
      expect(
        (await pool.query("SELECT publication_id FROM workspaces WHERE id=$1", [batchWorkspace]))
          .rows[0].publication_id,
      ).toBeNull();
      const draftDeletes = JSON.parse(
        await repository.mutateBatch(actor, {
          action: "delete-drafts",
          items: [
            { id: batchDrafts[1].id, revision: "999" },
            { id: batchDrafts[0].id, revision: "2" },
          ],
        }),
      );
      expect(draftDeletes.items.every((i: { status: string }) => i.status === "failed")).toBe(true);
      const draftDeleted = JSON.parse(
        await repository.mutateBatch(actor, {
          action: "delete-drafts",
          items: [{ id: batchDrafts[1].id, revision: "1" }],
        }),
      );
      expect(draftDeleted.items[0].status).toBe("succeeded");
      const longSlugContent = structuredClone(parsedContent);
      longSlugContent.problem.slug = `long-${crypto.randomUUID().replaceAll("-", "")}-${"a".repeat(42)}`;
      expect(longSlugContent.problem.slug).toHaveLength(80);
      const longSlugDraft = JSON.parse(
        await repository.create(actor, JSON.stringify(longSlugContent), undefined),
      );
      const readyLongSlug = JSON.parse(
        await repository.list(actor, {
          ...parseCatalogFilter(new URLSearchParams()),
          query: longSlugContent.problem.slug,
          sort: "title",
        }),
      );
      expect(
        readyLongSlug.items.find((item: { id: string }) => item.id === longSlugDraft.id)?.ready,
      ).toBe(true);
      const longSlugPublished = JSON.parse(
        await repository.publish(actor, longSlugDraft.id, "1", "private"),
      );
      expect(longSlugPublished.content.problem.slug).toHaveLength(105);
      const editedLongSlug = JSON.parse(
        await repository.update(
          actor,
          longSlugDraft.id,
          longSlugPublished.revision,
          JSON.stringify(longSlugPublished.content),
        ),
      );
      expect(editedLongSlug.content.problem.slug).toBe(longSlugPublished.content.problem.slug);
      const global = { userId: admin, admin: true, globalAllowed: true };
      const draftA = JSON.parse(await repository.create(global, raw, undefined));
      const draftB = JSON.parse(await repository.create(global, raw, undefined));
      const results = await Promise.allSettled([
        repository.publish({ ...global, globalAllowed: false }, draftA.id, "1", "global"),
        repository.publish(global, draftB.id, "1", "global"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const raceContent = structuredClone(parsedContent);
      raceContent.problem.slug = `race-${crypto.randomUUID().slice(0, 8)}`;
      const raceDraft = JSON.parse(
        await repository.create(global, JSON.stringify(raceContent), undefined),
      );
      const race = await Promise.allSettled([
        repository.publish(global, raceDraft.id, "1", "global"),
        repository.publish(global, raceDraft.id, "1", "global"),
      ]);
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(race.filter((r) => r.status === "rejected")).toHaveLength(1);
      const duplicate = structuredClone(parsedContent);
      duplicate.problem.slug = `rollback-${crypto.randomUUID().slice(0, 8)}`;
      duplicate.problem.leetcodeId =
        (parseInt(crypto.randomUUID().slice(0, 8), 16) % 2000000000) + 1;
      const d1 = JSON.parse(await repository.create(global, JSON.stringify(duplicate), undefined));
      const first = JSON.parse(await repository.publish(global, d1.id, "1", "global"));
      await pool.query("DELETE FROM question_drafts WHERE id=$1", [d1.id]);
      expect(
        JSON.parse(await repository.importDraft(global, JSON.stringify(duplicate), true)).status,
      ).toBe("unchanged");
      const refreshed = structuredClone(duplicate);
      refreshed.problem.title = "Refreshed question";
      const imported = JSON.parse(
        await repository.importDraft(global, JSON.stringify(refreshed), false),
      );
      expect(imported.status).toBe("created");
      const applied = JSON.parse(
        await repository.publish(
          { ...global, globalAllowed: false },
          imported.draftId,
          "1",
          "global",
        ),
      );
      expect(applied.publishedVersionId).toBe(first.publishedVersionId);
      expect(applied.content.problem.title).toBe("Refreshed question");
      const stepUpBatch = JSON.parse(
        await repository.mutateBatch(
          { ...global, globalAllowed: false },
          {
            action: "delete-publications",
            items: [{ id: first.publishedVersionId }],
          },
        ),
      );
      expect(stepUpBatch.items[0]).toMatchObject({ status: "failed", code: "step_up_required" });
      const duplicateBatch = JSON.parse(
        await repository.create(
          global,
          JSON.stringify({
            ...duplicate,
            problem: {
              ...duplicate.problem,
              slug: `batch-duplicate-${crypto.randomUUID().slice(0, 8)}`,
            },
          }),
          undefined,
        ),
      );
      const validBatch = JSON.parse(
        await repository.create(
          global,
          JSON.stringify({
            ...duplicate,
            problem: {
              ...duplicate.problem,
              leetcodeId: undefined,
              slug: `batch-valid-${crypto.randomUUID().slice(0, 8)}`,
            },
          }),
          undefined,
        ),
      );
      const mixedBatch = JSON.parse(
        await repository.mutateBatch(global, {
          action: "publish",
          items: [duplicateBatch, validBatch].map((d) => ({
            id: d.id,
            revision: d.revision,
            visibility: "global",
          })),
        }),
      );
      expect(mixedBatch.items.map((i: { status: string }) => i.status)).toEqual([
        "failed",
        "succeeded",
      ]);
      expect(JSON.parse(await repository.get(global, duplicateBatch.id)).revision).toBe("1");
      const workspace = crypto.randomUUID();
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,publication_id,language) VALUES($1,$2,$3,'python')",
        [workspace, owner, first.publishedVersionId],
      );
      const stableQuestionId = first.publishedVersionId;
      await pool.query(
        "INSERT INTO question_learning_events(submission_id,owner_id,publication_id,difficulty,tags,accepted,context,attempted_at) VALUES(gen_random_uuid(),$1,$2,'easy','{}',true,'practice',now())",
        [owner, stableQuestionId],
      );
      await pool.query(
        "INSERT INTO recommendation_impressions(owner_id,publication_id,variant,position) VALUES($1,$2,'control',1)",
        [owner, stableQuestionId],
      );
      const recommendationCounts = async () =>
        (
          await pool.query(
            `SELECT
          (SELECT count(*)::int FROM question_learning_events WHERE publication_id=$1) AS events,
          (SELECT count(*)::int FROM question_exposure WHERE publication_id=$1) AS exposures,
          (SELECT count(*)::int FROM recommendation_impressions WHERE publication_id=$1) AS impressions`,
            [stableQuestionId],
          )
        ).rows[0];
      const changed = structuredClone(applied.content);
      changed.problem.title = "Edited in place";
      const edited = JSON.parse(
        await repository.update(global, applied.id, applied.revision, JSON.stringify(changed)),
      );
      expect(edited.publishedVersionId).toBe(first.publishedVersionId);
      expect(edited.content.problem.title).toBe("Edited in place");
      expect(await recommendationCounts()).toEqual({
        events: 1,
        exposures: 1,
        impressions: 1,
      });
      expect(JSON.parse(await repository.deletionImpact(global, edited.id))).toMatchObject({
        workspaces: 1,
      });
      const active = crypto.randomUUID();
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','x','hash','queued','[]')",
        [active, owner, workspace],
      );
      await expect(
        repository.deletePublication(global, edited.id, edited.revision),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      await expect(
        repository.update(global, edited.id, edited.revision, JSON.stringify(changed)),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      await pool.query("UPDATE submissions SET state='cancelled' WHERE id=$1", [active]);
      const finishedJob = crypto.randomUUID();
      await pool.query("INSERT INTO execution_jobs(id,submission_id,finished) VALUES($1,$2,true)", [
        finishedJob,
        active,
      ]);
      await pool.query(
        `INSERT INTO runner_job_inputs(job_id,publication_id,metadata_hash,source_hash,runtime_revision,harness_revision,case_count,sample_count,private_details,submit_cases_are_samples)
         SELECT $1,publication_id,metadata_hash,metadata_hash,'python-3.12-v1','quorem-harness-v2',0,0,false,false
         FROM runner_publication_inputs WHERE publication_id=$2`,
        [finishedJob, first.publishedVersionId],
      );
      const afterDrain = JSON.parse(
        await repository.update(global, edited.id, edited.revision, JSON.stringify(changed)),
      );
      await expect(
        repository.deleteDraft(global, afterDrain.id, afterDrain.revision),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      await repository.deletePublication(global, afterDrain.id, afterDrain.revision);
      expect(await recommendationCounts()).toEqual({
        events: 0,
        exposures: 0,
        impressions: 0,
      });
      expect(
        (await pool.query("SELECT 1 FROM execution_jobs WHERE id=$1", [finishedJob])).rowCount,
      ).toBe(0);
      expect(await catalog.byPublication({ userId: owner }, first.publishedVersionId)).toBeNull();
      expect(
        (await pool.query("SELECT publication_id FROM workspaces WHERE id=$1", [workspace])).rows[0]
          .publication_id,
      ).toBeNull();

      await repository.publish(
        global,
        JSON.parse(await repository.create(global, JSON.stringify(duplicate), undefined)).id,
        "1",
        "global",
      );
      duplicate.problem.slug = `rollback-${crypto.randomUUID().slice(0, 8)}`;
      const d2 = JSON.parse(await repository.create(global, JSON.stringify(duplicate), undefined));
      await expect(repository.publish(global, d2.id, "1", "global")).rejects.toMatchObject({
        code: "invalid_input",
      });
      expect(
        (
          await pool.query("SELECT count(*)::int AS n FROM problems WHERE slug=$1", [
            duplicate.problem.slug,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(JSON.parse(await repository.get(global, d2.id)).revision).toBe("1");

      const edit = JSON.parse(await repository.create(actor, raw, undefined));
      const edits = await Promise.allSettled([
        repository.update(actor, edit.id, "1", raw),
        repository.update(actor, edit.id, "1", raw),
      ]);
      expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(edits.filter((r) => r.status === "rejected")).toHaveLength(1);
      await expect(repository.deleteDraft(actor, edit.id, "1")).rejects.toMatchObject({
        code: "revision_conflict",
      });
      await expect(
        repository.deleteDraft({ userId: other, admin: false }, edit.id, "2"),
      ).rejects.toMatchObject({ status: 404 });
      expect(JSON.parse(await repository.deleteDraft(actor, edit.id, "2"))).toEqual({
        deleted: true,
      });
      await pool.query(
        "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [owner],
      );
      await expect(repository.get(actor, edit.id)).rejects.toMatchObject({ status: 403 });
      await pool.query("UPDATE users SET role='user' WHERE id=$1", [admin]);
      await expect(repository.get(global, d2.id)).rejects.toMatchObject({ status: 403 });
    } finally {
      await pool.end();
    }
  });
});
