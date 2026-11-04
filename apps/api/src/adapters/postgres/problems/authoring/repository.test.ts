import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { authoringRoutes } from "../../../../modules/problems/authoring/routes.ts";
import { questionAuthoring } from "./repository.ts";
import { problemQueries } from "../queries/repository.ts";
const url = process.env.QUOREM_AUTHORING_TEST_DATABASE_URL;
const runtime = (language: string) =>
  (
    ({
      python: { revision: "python-3.12-v1", harness: "quorem-harness-v2" },
      postgresql: { revision: "postgresql-17.6-v1", harness: "quorem-postgresql-v2" },
      java: { revision: "java-21.0.9-v1", harness: "quorem-java-v1" },
      typescript: { revision: "typescript-5.9.3-node-22.21.1-v1", harness: "quorem-typescript-v1" },
      ocaml: { revision: "ocaml-4.13.1-v1", harness: "quorem-ocaml-v1" },
    }) as Record<string, { revision: string; harness: string }>
  )[language];
describe.skipIf(!url)("authoring on disposable PostgreSQL", () => {
  it("publishes atomically, fences revisions and protects owner content", async () => {
    const parsed = new URL(url!);
    expect(parsed.port).toBe("55447");
    expect(parsed.pathname).toBe("/quorem_hono_authoring_test");
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
        body: '{"content":{"problem":{},"hiddenCases":[],"attribution":"","implementations":[],"solutions":[]}}',
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
      await expect(repository.get({ userId: other, admin: false }, draft.id)).rejects.toMatchObject(
        { status: 404 },
      );
      const updated = JSON.parse(await repository.update(actor, draft.id, "1", raw));
      expect(updated.revision).toBe("2");
      await expect(repository.update(actor, draft.id, "1", raw)).rejects.toMatchObject({
        code: "revision_conflict",
      });
      const published = JSON.parse(await repository.publish(actor, draft.id, "2", "private"));
      expect(published.revision).toBe("3");
      expect(published.publishedVersionId).toBeTruthy();
      expect(await catalog.byVersion({ userId: owner }, published.publishedVersionId)).toContain(
        "class Solution",
      );
      expect(await catalog.byVersion(undefined, published.publishedVersionId)).toBeNull();
      await expect(repository.publish(actor, draft.id, "2", "private")).rejects.toMatchObject({
        code: "revision_conflict",
      });
      const fork = JSON.parse(
        await repository.create(actor, undefined, published.publishedVersionId),
      );
      expect(fork.content.hiddenCases).toHaveLength(parsedContent.hiddenCases.length);

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
      nul.implementations = nul.implementations.filter(
        (x: { language: string }) => x.language === "python",
      );
      nul.solutions = [];
      const nd = JSON.parse(await repository.create(actor, JSON.stringify(nul), undefined));
      const np = JSON.parse(await repository.publish(actor, nd.id, "1", "private"));
      const side = await pool.query(
        "SELECT lossless_fixture,lossless_public FROM problem_versions WHERE id=$1",
        [np.publishedVersionId],
      );
      expect(side.rows[0].lossless_fixture).not.toBeNull();
      expect(side.rows[0].lossless_public.toString()).not.toContain("SECRET");
      const publicView = await catalog.byVersion({ userId: owner }, np.publishedVersionId);
      expect(publicView).toContain("\\u0000");
      expect(publicView).not.toContain("SECRET");
      const cloned = JSON.parse(await repository.create(actor, undefined, np.publishedVersionId));
      expect(cloned.content.hiddenCases[0].args[0]).toBe("SECRET\u0000HIDDEN");
      await expect(
        repository.create({ userId: other, admin: false }, undefined, np.publishedVersionId),
      ).rejects.toMatchObject({ status: 403 });
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
      sq.implementations = [
        {
          language: "postgresql",
          starterSource: "select 1",
          referenceSource: "select 1",
          runtimeRevision: "postgresql-17.6-v1",
          harnessRevision: "quorem-postgresql-v2",
        },
      ];
      sq.solutions = [];
      const sqlRaw = JSON.stringify(sq).replaceAll('"rows":[[1]]', '"rows":[[1e309]]');
      const rawSqlDraft = await repository.create(actor, sqlRaw, undefined);
      expect(rawSqlDraft).toContain("1e309");
      const sd = JSON.parse(rawSqlDraft);
      expect(sd.content.problem.examples[0].args[0].tables[0].rows[0][0]).toBe(Infinity);
      const rawSqlPublished = await repository.publish(actor, sd.id, "1", "private");
      expect(rawSqlPublished).toContain("1e309");
      const sp = JSON.parse(rawSqlPublished);
      expect(await catalog.byVersion({ userId: owner }, sp.publishedVersionId)).toContain("1e309");
      expect(await repository.create(actor, undefined, sp.publishedVersionId)).toContain("1e309");
      const stored = await pool.query(
        "SELECT args::text FROM problem_test_cases WHERE version_id=$1",
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
        (await catalog.byVersion({ userId: owner }, op.publishedVersionId))!,
      );
      expect(stageView.odyssey.levels).toHaveLength(1);
      const stageFork = JSON.parse(
        await repository.create(actor, undefined, op.publishedVersionId),
      );
      expect(stageFork.content.problem.odyssey.levels).toHaveLength(2);
      expect(stageFork.content.odysseyHiddenCases).toHaveLength(2);
      const stagedSql = structuredClone(sq);
      stagedSql.problem.slug = `sqlstage-${crypto.randomUUID().slice(0, 8)}`;
      stagedSql.problem.odyssey = {
        levels: [
          {
            title: "First",
            statementMarkdown: "Query items",
            methods: [],
            examples: stagedSql.problem.examples,
          },
        ],
      };
      stagedSql.odysseyHiddenCases = [stagedSql.hiddenCases];
      stagedSql.problem.examples = [];
      stagedSql.hiddenCases = [];
      const osd = JSON.parse(await repository.create(actor, JSON.stringify(stagedSql), undefined));
      const osp = JSON.parse(await repository.publish(actor, osd.id, "1", "private"));
      const sqlFork = JSON.parse(await repository.create(actor, undefined, osp.publishedVersionId));
      expect(sqlFork.content.odysseyHiddenCases).toHaveLength(1);
      const global = { userId: admin, admin: true, globalAllowed: true };
      const draftA = JSON.parse(await repository.create(global, raw, undefined));
      const draftB = JSON.parse(await repository.create(global, raw, undefined));
      await expect(
        repository.publish({ ...global, globalAllowed: false }, draftA.id, "1", "global"),
      ).rejects.toMatchObject({ code: "step_up_required" });
      const results = await Promise.all([
        repository.publish(global, draftA.id, "1", "global"),
        repository.publish(global, draftB.id, "1", "global"),
      ]);
      const versions = results
        .map((r) => Number(JSON.parse(r).content.problem.version))
        .sort((a, b) => a - b);
      expect(versions).toEqual([1, 2]);
      const raceDraft = JSON.parse(await repository.create(global, raw, undefined));
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
      const applied = JSON.parse(await repository.publish(global, imported.draftId, "1", "global"));
      expect(applied.publishedVersionId).toBe(first.publishedVersionId);
      expect(applied.content.problem.title).toBe("Refreshed question");
      const workspace = crypto.randomUUID();
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [workspace, owner, first.publishedVersionId],
      );
      const changed = structuredClone(applied.content);
      changed.problem.title = "Edited in place";
      const edited = JSON.parse(
        await repository.update(global, applied.id, applied.revision, JSON.stringify(changed)),
      );
      expect(edited.publishedVersionId).toBe(first.publishedVersionId);
      expect(edited.content.problem.title).toBe("Edited in place");
      expect(JSON.parse(await repository.deletionImpact(global, edited.id))).toMatchObject({
        current: true,
        workspaces: 1,
      });
      await expect(
        repository.deletePublication(global, edited.id, edited.revision, undefined),
      ).rejects.toMatchObject({ code: "invalid_input" });
      const active = crypto.randomUUID();
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','x','hash','queued','[]')",
        [active, owner, workspace],
      );
      await expect(
        repository.deletePublication(global, edited.id, edited.revision, null),
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
        `INSERT INTO runner_job_inputs(job_id,version_id,metadata_hash,source_hash,runtime_revision,harness_revision,case_count,sample_count,private_details,submit_cases_are_samples)
         SELECT $1,version_id,metadata_hash,metadata_hash,'python-3.12-v1','quorem-harness-v2',0,0,false,false
         FROM runner_version_inputs WHERE version_id=$2`,
        [finishedJob, first.publishedVersionId],
      );
      const afterDrain = JSON.parse(
        await repository.update(global, edited.id, edited.revision, JSON.stringify(changed)),
      );
      await expect(
        repository.deleteDraft(global, afterDrain.id, afterDrain.revision),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      await repository.deletePublication(global, afterDrain.id, afterDrain.revision, null);
      expect(
        (await pool.query("SELECT 1 FROM execution_jobs WHERE id=$1", [finishedJob])).rowCount,
      ).toBe(0);
      expect(await catalog.byVersion({ userId: owner }, first.publishedVersionId)).toBeNull();
      expect(
        (await pool.query("SELECT problem_version_id FROM workspaces WHERE id=$1", [workspace]))
          .rows[0].problem_version_id,
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
