import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { migrate } from "../packages/database/src/migrations.ts";
import { createProductionBenchmarkActors } from "./hono-production-workload-actors.mjs";
const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");

void test("production benchmark authority rejects local or malformed destinations", async () => {
  for (const databaseURL of [
    "postgres://localhost/neondb",
    "postgres://example.test/neondb?sslmode=verify-full",
    "postgres://example.neon.tech/other?sslmode=verify-full",
  ])
    await assert.rejects(
      createProductionBenchmarkActors({ databaseURL, authSecret: "a".repeat(40) }),
      /authority/,
    );
});
void test("temporary actor counts remain bounded", async () => {
  for (const count of [0, 9, 1.5])
    await assert.rejects(
      createProductionBenchmarkActors({
        databaseURL: "postgres://fixture.neon.tech/neondb?sslmode=verify-full",
        authSecret: "a".repeat(40),
        count,
      }),
      /authority/,
    );
});
void test(
  "temporary benchmark actors are ordinary users and all sessions are revoked",
  { skip: !process.env.QUOREM_BENCHMARK_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.QUOREM_BENCHMARK_TEST_DATABASE_URL);
    assert.equal(url.pathname, "/quorem_hono_benchmark_test");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    const pool = new Pool({ connectionString: url.href });
    let fixture;
    try {
      await migrate(pool, "product", new URL("../apps/api/migrations/", import.meta.url).pathname);
      await migrate(pool, "auth", new URL("../apps/auth/migrations/", import.meta.url).pathname);
      await pool.query(
        "INSERT INTO users(id,display_name) VALUES('benchmark-operator','Fixture') ON CONFLICT DO NOTHING",
      );
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator','fixture','benchmark-operator','fixture','fixture','fixture') ON CONFLICT DO NOTHING",
      );
      fixture = await createProductionBenchmarkActors({
        databaseURL: url.href,
        authSecret: "a".repeat(40),
        mode: "local-test",
      });
      assert.equal(fixture.actors.length, 8);
      const ids = fixture.actors.map((actor) => actor.id);
      assert.ok(
        fixture.actors.every(
          (actor) => typeof actor.cookie === "string" && actor.cookie.includes("session_token="),
        ),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM users WHERE id=ANY($1::text[]) AND role='user' AND NOT disabled",
            [ids],
          )
        ).rows[0].n,
        8,
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM quorem_auth.session s JOIN identity_bindings b ON b.subject=s."userId" WHERE b.user_id=ANY($1::text[])',
            [ids],
          )
        ).rows[0].n,
        8,
      );
      await fixture.dispose();
      await fixture.dispose();
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM users WHERE id=ANY($1::text[]) AND disabled",
            [ids],
          )
        ).rows[0].n,
        8,
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM quorem_auth.session s JOIN identity_bindings b ON b.subject=s."userId" WHERE b.user_id=ANY($1::text[])',
            [ids],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await fixture?.dispose();
      await pool.end();
    }
  },
);
