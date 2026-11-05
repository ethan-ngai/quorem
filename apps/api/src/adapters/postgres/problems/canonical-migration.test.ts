/** @file canonical-migration.test.ts @description Retained solution migration preserves drafts and sealed provenance. @module problems */
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createNodePool } from "@quorem/database/core";
import { storageProjection } from "./storage.ts";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
import { migrate } from "@quorem/database/migrations";
const url = process.env.QUOREM_CANONICAL_TEST_DATABASE_URL;

it.skipIf(!url)(
  "migrates populated sealed versions and lossless drafts without replacing published editorials",
  async () => {
    assertRunnerFixture(url!, ["/quorem_hono_canonical_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const directory = await mkdtemp(join(tmpdir(), "quorem-canonical-migrations-"));
    const migrations = new URL("../../../../migrations/", import.meta.url);
    try {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      for (const file of await readdir(migrations))
        if (file.endsWith(".sql") && file < "073_")
          await writeFile(join(directory, file), await readFile(new URL(file, migrations)));
      await migrate(pool, "product", directory);
      const ids = [crypto.randomUUID(), crypto.randomUUID()];
      await pool.query(
        "INSERT INTO users(id,display_name) VALUES('canonical-migration','Fixture')",
      );
      for (const [i, version] of ids.entries()) {
        const problem = crypto.randomUUID();
        await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [
          problem,
          `canonical-${i}`,
        ]);
        await pool.query(
          "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Fixture','easy','Statement','{}','[]','{}','fixture')",
          [version, problem],
        );
        await pool.query(
          "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','starter','runtime','harness','reference')",
          [version],
        );
        if (i === 0)
          await pool.query(
            "INSERT INTO problem_solutions VALUES($1,'python','existing editorial','explanation','O(n)','O(1)','notes')",
            [version],
          );
        await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [version]);
      }
      const raw = String.raw`{"problem":{"sql":null},"hiddenCases":[{"args":[-0,1e309,"\u0000","\\u0000","\\\u0000","\u0001"]}],"implementations":[{"language":"python","referenceSource":"reference"}],"solutions":[]}`;
      const safe = storageProjection(raw).safe;
      const draft = (
        await pool.query(
          "INSERT INTO question_drafts(content,lossless_content,created_by,updated_by,import_digest) VALUES($1,$2,'canonical-migration','canonical-migration','old-import') RETURNING id",
          [safe, Buffer.from(raw)],
        )
      ).rows[0].id;
      await writeFile(
        join(directory, "073_canonical_solution.sql"),
        await readFile(new URL("073_canonical_solution.sql", migrations)),
      );
      await migrate(pool, "product", directory);
      const solutions = (
        await pool.query(
          "SELECT source FROM problem_solutions WHERE version_id=ANY($1) ORDER BY source",
          [ids],
        )
      ).rows.map((item) => item.source);
      expect(solutions).toEqual(["existing editorial", "reference"]);
      expect(
        (
          await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='problem_languages' AND column_name='reference_source'",
          )
        ).rows,
      ).toEqual([]);
      const hash = (
        await pool.query(
          "SELECT reference_source_hash FROM problem_languages WHERE version_id=$1",
          [ids[0]],
        )
      ).rows[0].reference_source_hash;
      expect(Buffer.from(hash).toString("hex")).toBe(
        createHash("sha256")
          .update(Buffer.concat([Buffer.from([1]), Buffer.from("reference")]))
          .digest("hex"),
      );
      const saved = (
        await pool.query(
          "SELECT content,convert_from(lossless_content,'UTF8') AS raw,revision::text,import_digest FROM question_drafts WHERE id=$1",
          [draft],
        )
      ).rows[0];
      expect(saved.content.canonicalSolution.source).toBe("reference");
      expect(saved.content.implementations).toEqual([{ language: "python" }]);
      expect(saved.raw).toContain("-0");
      expect(saved.raw).toContain("1e309");
      expect(saved.raw).toContain("\\u0000");
      expect(JSON.parse(saved.raw).hiddenCases[0].args.slice(2)).toEqual([
        "\0",
        "\\u0000",
        "\\\0",
        "\u0001",
      ]);
      expect(saved.revision).toBe("2");
      expect(saved.import_digest).toBeNull();
      await expect(
        pool.query("UPDATE problem_solutions SET source='mutated' WHERE version_id=$1", [ids[0]]),
      ).rejects.toThrow();
    } finally {
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
