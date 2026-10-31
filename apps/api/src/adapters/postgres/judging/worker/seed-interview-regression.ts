/** @file seed-interview-regression.ts @description Seed one disposable interview regression database. @module judging */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { languageRuntime } from "@quorem/execution";
import { persistQuestionVersion } from "../../problems/publication.ts";
const url = process.env.QUOREM_INTERVIEW_REGRESSION_URL;
if (
  !url ||
  new URL(url).hostname !== "127.0.0.1" ||
  new URL(url).port !== "55576" ||
  !["/quorem_hono_interview_questions_test", "/quorem_hono_interview_execution_test"].includes(
    new URL(url).pathname,
  )
)
  throw new Error("Disposable interview regression database required");
const pool = createNodePool({
  connectionString: url,
  max: 2,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  onIdleError: (e) => {
    throw e;
  },
});
try {
  await migrate(pool, "product", resolve("migrations"));
  const id = crypto.randomUUID(),
    version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
    raw = readFileSync("../../fixtures/problems/run-widths.json", "utf8");
  await withNodeConnection(pool, { lifetimeMs: 20000 }, (scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${id}::uuid,'run-widths')`);
      await persistQuestionVersion(tx, raw, id, version, 3, null, (language) => {
        const v = languageRuntime(language);
        return v ? { revision: v.revision, harness: v.harness } : undefined;
      });
      await tx.execute(
        sql`UPDATE problems SET current_version_id=${version}::uuid WHERE id=${id}::uuid`,
      );
    }),
  );
} finally {
  await pool.end();
}
