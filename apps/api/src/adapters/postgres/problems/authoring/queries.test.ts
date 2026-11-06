import { describe, expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import { parseCatalogFilter } from "../../../../modules/problems/queries.ts";
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { authoringQueries } from "./queries.ts";

const url = process.env.QUOREM_AUTHORING_TEST_DATABASE_URL;
describe.skipIf(!url)("draft readiness pagination", () => {
  it("matches SQL ordering across batches, ties and microsecond timestamps", async () => {
    assertRunnerFixture(url!, ["/quorem_hono_authoring_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const user = `readiness-${crypto.randomUUID()}`;
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Author')", [user]);
      await pool.query(
        `INSERT INTO question_drafts(content,created_by,updated_by,owner_id,updated_at)
        SELECT jsonb_build_object('problem',jsonb_build_object('title','Title '||(n%3),
          'slug',n::text,'difficulty',(ARRAY['easy','medium','hard'])[1+n%3])),
          $1,$1,$1,'2026-01-01 00:00:00+00'::timestamptz + (n%67)*interval '1 microsecond'
        FROM generate_series(1,105) AS n`,
        [user],
      );
      const queries = authoringQueries(
        (action, readOnly) =>
          withNodeConnection(pool, { lifetimeMs: 15000 }, (scope) =>
            scope.transaction(
              {
                readOnly,
                isolation: "repeatable read",
                statementTimeoutMs: 5000,
                lockTimeoutMs: 2000,
              },
              action,
            ),
          ),
        async () => ({ admin: false }),
        (raw) => {
          if (Number(JSON.parse(raw).problem.slug) % 2 === 0)
            throw new ApplicationError("invalid_input", "Not ready", 400);
        },
      );
      const actor = { userId: user, admin: false };
      for (const sort of ["title", "difficulty", "updatedAt"] as const)
        for (const order of ["asc", "desc"] as const) {
          const base = { ...parseCatalogFilter(new URLSearchParams()), sort, order, limit: 200 };
          const all = JSON.parse(await queries.list(actor, base));
          for (const readiness of ["ready", "needs-fixes"]) {
            const expected = all.items.filter(
              (item: { ready: boolean }) => item.ready === (readiness === "ready"),
            );
            const page = JSON.parse(
              await queries.list(actor, { ...base, readiness, page: 2, limit: 17 }),
            );
            expect(page.total, `${sort}/${order}/${readiness}`).toBe(expected.length);
            expect(page.items.map((item: { id: string }) => item.id)).toEqual(
              expected.slice(17, 34).map((item: { id: string }) => item.id),
            );
          }
        }
    } finally {
      await pool.query("DELETE FROM question_drafts WHERE owner_id=$1", [user]);
      await pool.query("DELETE FROM users WHERE id=$1", [user]);
      await pool.end();
    }
  });
});
