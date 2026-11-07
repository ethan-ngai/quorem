/** @file approaches-migration.test.ts @description Approach migration preserves code, differing metadata and lossless cases. @module problems */
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { storageProjection } from "./storage.ts";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
const url = process.env.QUOREM_APPROACHES_TEST_DATABASE_URL;
it.skipIf(!url)(
  "consolidates metadata without discarding alternatives or changing sealed language provenance",
  async () => {
    assertRunnerFixture(url!, ["/quorem_hono_approaches_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const dir = await mkdtemp(join(tmpdir(), "quorem-approaches-"));
    const migrations = new URL("../../../../migrations/legacy/", import.meta.url);
    try {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      for (const file of await readdir(migrations))
        if (file.endsWith(".sql") && file < "074_")
          await writeFile(join(dir, file), await readFile(new URL(file, migrations)));
      await migrate(pool, "product", dir);
      const problem = crypto.randomUUID(),
        version = crypto.randomUUID();
      await pool.query("INSERT INTO users(id,display_name) VALUES('approach-migration','Fixture')");
      await pool.query("INSERT INTO problems(id,slug) VALUES($1,'approach-migration')", [problem]);
      await pool.query(
        "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Fixture','easy','Statement','{}','[]','{}','fixture')",
        [version, problem],
      );
      const primary = {
        language: "python",
        source: "reference",
        explanationMarkdown: "Hash map",
        timeComplexity: "O(n)",
        spaceComplexity: "O(n)",
        complexityNotes: "Base note",
      };
      const additional = [
        {
          ...primary,
          language: "java",
          source: "java code",
          spaceComplexity: "O(2n)",
          complexityNotes: "Conversion buffer",
        },
        {
          ...primary,
          language: "ocaml",
          source: "ocaml code",
          explanationMarkdown: "Sorting",
          timeComplexity: "O(n log n)",
        },
      ];
      for (const solution of [primary, ...additional]) {
        await pool.query(
          "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision) VALUES($1,$2,'starter','runtime','harness')",
          [version, solution.language],
        );
        await pool.query(
          "INSERT INTO problem_solutions(version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            version,
            solution.language,
            solution.source,
            solution.explanationMarkdown,
            solution.timeComplexity,
            solution.spaceComplexity,
            solution.complexityNotes,
          ],
        );
      }
      await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [version]);
      const before = (
        await pool.query(
          "SELECT language,encode(reference_source_hash,'hex') AS hash FROM problem_languages ORDER BY language",
        )
      ).rows;
      const raw = JSON.stringify({
        problem: {},
        implementations: [],
        canonicalSolution: primary,
        solutions: additional,
      }).replace(/}$/, String.raw`,"hiddenCases":[{"args":[-0,1e309,"\u0000","\\u0000"]}]}`);
      const draft = (
        await pool.query(
          "INSERT INTO question_drafts(content,lossless_content,created_by,updated_by) VALUES($1,$2,'approach-migration','approach-migration') RETURNING id",
          [storageProjection(raw).safe, Buffer.from(raw)],
        )
      ).rows[0].id;
      await writeFile(
        join(dir, "074_solution_approaches.sql"),
        await readFile(new URL("074_solution_approaches.sql", migrations)),
      );
      await migrate(pool, "product", dir);
      const approaches = (
        await pool.query(
          "SELECT id,title,is_canonical,explanation_markdown,complexity_notes FROM problem_solution_approaches WHERE version_id=$1 ORDER BY ordinal",
          [version],
        )
      ).rows;
      expect(approaches).toHaveLength(2);
      expect(approaches[0]).toMatchObject({
        id: "default",
        title: "",
        is_canonical: true,
        explanation_markdown: "Hash map",
      });
      expect(approaches[0].complexity_notes).toContain(
        "Java: Time O(n); auxiliary space O(2n). Conversion buffer",
      );
      expect(approaches[1].explanation_markdown).toBe("Sorting");
      expect(
        (
          await pool.query(
            "SELECT language,source,approach_id FROM problem_solutions ORDER BY language",
          )
        ).rows,
      ).toEqual([
        { language: "java", source: "java code", approach_id: "default" },
        { language: "ocaml", source: "ocaml code", approach_id: "alternative-2" },
        { language: "python", source: "reference", approach_id: "default" },
      ]);
      expect(
        (
          await pool.query(
            "SELECT language,encode(reference_source_hash,'hex') AS hash FROM problem_languages ORDER BY language",
          )
        ).rows,
      ).toEqual(before);
      const saved = (
        await pool.query(
          "SELECT content,convert_from(lossless_content,'UTF8') AS raw,revision::text FROM question_drafts WHERE id=$1",
          [draft],
        )
      ).rows[0];
      expect(saved.content.canonicalApproachId).toBe("default");
      expect(saved.content.approaches).toHaveLength(2);
      expect(saved.content).not.toHaveProperty("canonicalSolution");
      expect(saved.raw).toContain("-0");
      expect(saved.raw).toContain("1e309");
      expect(JSON.parse(saved.raw).hiddenCases[0].args.slice(2)).toEqual(["\0", "\\u0000"]);
      expect(saved.revision).toBe("2");
      expect(
        (
          await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='problem_solutions' ORDER BY ordinal_position",
          )
        ).rows.map((r) => r.column_name),
      ).toEqual(["version_id", "language", "source", "approach_id"]);
      await expect(
        pool.query("UPDATE problem_solution_approaches SET title='changed' WHERE version_id=$1", [
          version,
        ]),
      ).rejects.toThrow();
    } finally {
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
