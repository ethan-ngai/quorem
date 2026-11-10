/** @file state-migration.test.ts @description Published questions derive runtime state without rewriting sealed identities. @module problems */
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { languageRuntime } from "@quorem/execution";
import type { Principal } from "../../../modules/identity/model.ts";
import { storageProjection } from "./storage.ts";
import { fixtureSourceHash } from "../judging/inputs/source.ts";
import { problemQueries } from "./queries/repository.ts";
import { questionAuthoring } from "./authoring/repository.ts";
import { workspaceRepository } from "../workspace/repository.ts";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
const url = process.env.QUOREM_QUESTION_STATE_TEST_DATABASE_URL;

it.skipIf(!url)(
  "migrates published Python-only questions and lossless drafts without a resave",
  async () => {
    assertRunnerFixture(url!, ["/quorem_hono_question_state_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const directory = await mkdtemp(join(tmpdir(), "quorem-question-state-"));
    const migrations = new URL("../../../../migrations/legacy/", import.meta.url);
    try {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      for (const file of await readdir(migrations))
        if (file.endsWith(".sql") && file < "075_")
          await writeFile(join(directory, file), await readFile(new URL(file, migrations)));
      await migrate(pool, "product", directory);
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES('state-owner','Owner','admin')",
      );
      const paths = [
        "problems/run-widths.json",
        "migration/sql-positive-items.json",
        "odyssey/balance-ledger.json",
      ];
      const versions: string[] = [],
        hashes: string[] = [];
      let staged: Record<string, any> | undefined;
      for (const [index, path] of paths.entries()) {
        const content = JSON.parse(
          await readFile(new URL(`../../../../../../fixtures/${path}`, import.meta.url), "utf8"),
        );
        const p = content.problem;
        const id = index === 0 ? "00000000-0000-4000-8000-000000007501" : crypto.randomUUID(),
          parent = index === 0 ? "00000000-0000-4000-8000-000000007502" : crypto.randomUUID();
        versions.push(id);
        p.id = id;
        p.slug = `state-${index}`;
        const language = p.sql ? "postgresql" : "python";
        if (p.odyssey) {
          content.odysseyHiddenCases = p.odyssey.levels.map((level: any) => level.hiddenCases);
          p.odyssey.levels.forEach((level: any) => delete level.hiddenCases);
          p.signature = structuredClone(p.odyssey.levels[0].methods[0]);
          staged = structuredClone(content);
        } else if (p.sql)
          p.signature = {
            className: "Solution",
            methodName: "obsolete",
            parameters: [],
            returnType: "int",
          };
        content.implementations = [
          {
            language,
            starterSource: "# stale, untyped",
            runtimeRevision: "old-runtime",
            harnessRevision: "old-harness",
          },
        ];
        content.approaches[0].defaultLanguage = language;
        if (p.odyssey) staged = structuredClone(content);
        const raw = JSON.stringify(content),
          stored = storageProjection(raw);
        hashes.push(
          index === 0
            ? "adbe6eb0acf9bb68660731b853f1b7bd7b6e06241dba89b4d0045489f00bcd86"
            : createHash("sha256").update(raw).digest("hex"),
        );
        await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [parent, p.slug]);
        await pool.query(
          `INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,lossless_fixture)
        SELECT $1,$2,1,p->>'title',p->>'difficulty',p->>'statementMarkdown',p->'signature',p->'constraints',p->'limits',$4,p->'sql',p->'odyssey',$5 FROM (SELECT $3::jsonb AS p) q`,
          [
            id,
            parent,
            JSON.stringify(p),
            content.attribution,
            index === 0 ? null : Buffer.from(raw),
          ],
        );
        await pool.query(
          "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision) VALUES($1,$2,'# stale, untyped','old-runtime','old-harness')",
          [id, language],
        );
        const safe = JSON.parse(stored.safe);
        for (const [ordinal, example] of safe.problem.examples.entries())
          await pool.query(
            "INSERT INTO problem_examples(version_id,ordinal,args,expected,calls) VALUES($1,$2,$3,$4,$5)",
            [
              id,
              ordinal,
              JSON.stringify(example.args),
              JSON.stringify(example.expected),
              JSON.stringify(example.calls ?? []),
            ],
          );
        for (const [ordinal, test] of safe.hiddenCases.entries())
          await pool.query(
            "INSERT INTO problem_test_cases(version_id,ordinal,args,expected,calls) VALUES($1,$2,$3,$4,$5)",
            [
              id,
              ordinal,
              JSON.stringify(test.args),
              JSON.stringify(test.expected),
              JSON.stringify(test.calls ?? []),
            ],
          );
        for (const [level, tests] of (safe.odysseyHiddenCases ?? []).entries())
          for (const [ordinal, test] of tests.entries())
            await pool.query(
              "INSERT INTO problem_odyssey_cases(version_id,level,ordinal,case_data) VALUES($1,$2,$3,$4)",
              [id, level, ordinal, JSON.stringify(test)],
            );
        const approach = content.approaches[0];
        await pool.query(
          "INSERT INTO problem_solution_approaches(version_id,id,ordinal,title,is_canonical,default_language,explanation_markdown,time_complexity,space_complexity,complexity_notes) VALUES($1,$2,0,'',true,$3,'','','','')",
          [id, approach.id, language],
        );
        await pool.query(
          "INSERT INTO problem_solutions(version_id,approach_id,language,source) VALUES($1,$2,$3,$4)",
          [id, approach.id, language, approach.implementations[0].source],
        );
        await pool.query("UPDATE problems SET current_version_id=$1 WHERE id=$2", [id, parent]);
        await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [id]);
      }
      const legacy = JSON.stringify(staged).replace(
        '"odysseyHiddenCases":[[',
        '"odysseyHiddenCases":[[{"args":["a\\u0000b",1e309],"expected":-0},',
      );
      const draft = storageProjection(legacy);
      const draftId = (
        await pool.query(
          "INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,import_digest) VALUES($1,$2,'state-owner','state-owner','receipt') RETURNING id",
          [draft.safe, draft.lossless],
        )
      ).rows[0].id;
      const pending = (
        await pool.query(
          "INSERT INTO question_drafts(content,created_by,updated_by,edit_version_id,edit_base) SELECT $1,'state-owner','state-owner',id,xmin::text FROM problem_versions WHERE id=$2 RETURNING id",
          [draft.safe, versions[0]],
        )
      ).rows[0].id;
      const stale = (
        await pool.query(
          "INSERT INTO question_drafts(content,created_by,updated_by,edit_version_id,edit_base) VALUES($1,'state-owner','state-owner',$2,'stale') RETURNING id",
          [draft.safe, versions[1]],
        )
      ).rows[0].id;
      await writeFile(
        join(directory, "075_derived_question_languages.sql"),
        await readFile(new URL("075_derived_question_languages.sql", migrations)),
      );
      await migrate(pool, "product", directory);
      expect(
        (await pool.query("SELECT to_regclass('public.problem_languages') AS table")).rows[0].table,
      ).toBeNull();
      expect(
        (
          await pool.query(
            "SELECT d.edit_base=v.xmin::text AS current FROM question_drafts d JOIN problem_versions v ON v.id=d.edit_version_id WHERE d.id=$1",
            [pending],
          )
        ).rows[0].current,
      ).toBe(true);
      expect(
        (await pool.query("SELECT edit_base FROM question_drafts WHERE id=$1", [stale])).rows[0]
          .edit_base,
      ).toBe("stale");
      const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
      await migrate(pool, "product", fileURLToPath(new URL("../", migrations)));
      for (const [index, id] of versions.entries()) {
        const hash = await run((scope) =>
          scope.transaction(
            { readOnly: true, statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
            (tx) => fixtureSourceHash(tx, { publication: id }),
          ),
        );
        expect(Buffer.from(hash).toString("hex")).toBe(hashes[index]);
      }
      const catalog = problemQueries(run);
      const coding = JSON.parse((await catalog.byPublication(undefined, versions[0]))!);
      expect(coding.languages.map((item: any) => item.language)).toEqual([
        "python",
        "java",
        "typescript",
        "ocaml",
      ]);
      expect(coding.starterSource).toContain("values: list[int]");
      const sql = JSON.parse((await catalog.byPublication(undefined, versions[1]))!);
      expect(sql).not.toHaveProperty("signature");
      expect(sql.languages.map((item: any) => item.language)).toEqual(["postgresql"]);
      const steps = JSON.parse((await catalog.byPublication(undefined, versions[2]))!);
      expect(steps.signature.methodName).toBe(steps.odyssey.levels[0].methods[0].methodName);
      expect(steps.odyssey.levels[0]).not.toHaveProperty("hiddenCases");
      const saved = (
        await pool.query(
          "SELECT convert_from(lossless_content,'UTF8') AS raw,content,import_digest FROM question_drafts WHERE id=$1",
          [draftId],
        )
      ).rows[0];
      expect(saved.raw).toContain("1e309");
      expect(saved.raw).toContain('"expected":-0');
      expect(saved.raw).toContain("\\u0000");
      expect(saved.content).not.toHaveProperty("implementations");
      expect(saved.content).not.toHaveProperty("odysseyHiddenCases");
      expect(saved.content.problem).not.toHaveProperty("signature");
      expect(saved.content.problem.odyssey.levels[0].hiddenCases.length).toBeGreaterThan(0);
      expect(saved.content.approaches[0]).not.toHaveProperty("defaultLanguage");
      expect(saved.import_digest).toBeNull();
      const principal = { kind: "local", userId: "state-owner" } as Principal;
      const workspace = await workspaceRepository(run).create(principal, versions[0], "java");
      expect(workspace.language).toBe("java");
      const author = questionAuthoring(run, languageRuntime),
        actor = { userId: "state-owner", admin: true, globalAllowed: true };
      const editing = JSON.parse(await author.create(actor, undefined, versions[0]));
      editing.content.problem.title = "Updated with an existing Java workspace";
      await author.update(actor, editing.id, editing.revision, JSON.stringify(editing.content));
      expect(JSON.parse((await catalog.byPublication(undefined, versions[0]))!).title).toBe(
        editing.content.problem.title,
      );
    } finally {
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
