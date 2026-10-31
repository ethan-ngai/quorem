import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { assertStageDatabase, createStagedActor } from "./staged-actor.ts";
import { startNodeRuntime } from "../../node.ts";

void test("stage database guard rejects unsafe names, overrides and unverified TLS", () => {
  for (const value of [
    "postgres://localhost/production",
    "postgres://localhost/quorem_hono_stage?HOST=elsewhere",
    "postgres://localhost/quorem_hono_stage#fragment",
    "postgres://example.test/quorem_hono_stage",
    "postgres://example.test/quorem_hono_stage?sslmode=require",
    "postgres://example.test/quorem_hono_stage?sslmode=verify-full&SSLMODE=disable",
  ])
    assert.throws(() => assertStageDatabase(value, "stage"));
  assert.doesNotThrow(() =>
    assertStageDatabase("postgres://example.test/quorem_hono_stage?sslmode=verify-full", "stage"),
  );
  assert.throws(() =>
    assertStageDatabase(
      "postgres://example.test/quorem_hono_stage_fixture_test?sslmode=verify-full",
      "local-test",
    ),
  );
  assert.doesNotThrow(() =>
    assertStageDatabase("postgres://127.0.0.1:56789/quorem_hono_stage_fixture_test", "local-test"),
  );
});
const url = process.env.QUOREM_STAGE_FIXTURE_TEST_DATABASE_URL;
const emptyURL = process.env.QUOREM_STAGE_FIXTURE_EMPTY_DATABASE_URL;
void test(
  "refuses an unmigrated fixture database without creating schemas",
  { skip: !emptyURL },
  async () => {
    assertStageDatabase(emptyURL!, "local-test");
    const pool = createNodePool({
      connectionString: emptyURL!,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    try {
      await assert.rejects(
        createStagedActor({
          databaseURL: emptyURL!,
          authOrigin: "http://127.0.0.1:8765",
          authSecret: "local-runtime-fixture-secret-32-characters",
          mode: "local-test",
        }),
      );
      const row = (
        await pool.query(
          "SELECT to_regclass('public.schema_migrations') AS product,to_regclass('quorem_auth.schema_migrations') AS auth",
        )
      ).rows[0];
      assert.equal(row.product, null);
      assert.equal(row.auth, null);
    } finally {
      await pool.end();
    }
  },
);
void test(
  "fixture cookie authorizes Node and workerd, and revocation invalidates its bearer",
  { skip: !url, timeout: 120000 },
  async () => {
    assertStageDatabase(url!, "local-test");
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const origin = "http://127.0.0.1:8765",
      secret = "local-runtime-fixture-secret-32-characters";
    let worker: ReturnType<typeof spawn> | undefined;
    let runtime: Awaited<ReturnType<typeof startNodeRuntime>> | undefined;
    let actor: Awaited<ReturnType<typeof createStagedActor>> | undefined;
    try {
      await migrate(
        pool,
        "product",
        fileURLToPath(new URL("../../../../migrations/", import.meta.url)),
      );
      await migrate(
        pool,
        "auth",
        fileURLToPath(new URL("../../../../../auth/migrations/", import.meta.url)),
      );
      const sentinel = `stage-sentinel-${crypto.randomUUID()}`;
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$1)", [sentinel]);
      const secure = await createStagedActor({
        databaseURL: url!,
        authOrigin: "https://fixture.test",
        authSecret: secret,
        mode: "local-test",
      });
      assert.ok(secure.sessionCookie.startsWith("__Secure-better-auth.session_token="));
      await secure.dispose();
      actor = await createStagedActor({
        databaseURL: url!,
        authOrigin: origin,
        authSecret: secret,
        mode: "local-test",
      });
      const sessionToken = decodeURIComponent(
        actor.sessionCookie.split("=").slice(1).join("="),
      ).split(".")[0];
      const expiry = await pool.query(
        'SELECT "expiresAt">clock_timestamp() AND "expiresAt"<=clock_timestamp()+interval \'1 hour\' AS bounded FROM quorem_auth."session" WHERE token=$1',
        [sessionToken],
      );
      assert.equal(expiry.rows[0].bounded, true);
      assert.equal(
        (await pool.query("SELECT display_name FROM users WHERE id=$1", [sentinel])).rows[0]
          .display_name,
        sentinel,
      );
      const env = {
        ...process.env,
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: origin,
        AUTH_DATABASE_URL: url!,
        DATABASE_URL: url!,
        QUOREM_DATABASE_LISTEN_URL: url!,
        BETTER_AUTH_SECRET: secret,
        AUTH_INTERNAL_SECRET: "local-test-internal",
        QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
        MATCH_INVITE_KEY: "ab".repeat(32),
        EXECUTION_WAKE_PROVIDER: "sqs",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
        PORT: "0",
        IDENTITY_MODE: "managed",
        GUEST_CREATION: "false",
        GUEST_ADMISSION: "true",
      };
      runtime = await startNodeRuntime(env);
      if (!runtime.server.listening) await once(runtime.server, "listening");
      const nodeBase = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
      worker = spawn(
        "vp",
        [
          "exec",
          "wrangler",
          "dev",
          "--config",
          "src/runtime/composition/wrangler.test.jsonc",
          "--port",
          "8765",
          "--ip",
          "127.0.0.1",
        ],
        {
          cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
          stdio: "ignore",
          env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB: url! },
        },
      );
      let ready = false;
      for (let i = 0; i < 300; i++) {
        if (worker.exitCode !== null) break;
        try {
          if ((await fetch(`${origin}/health`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await sleep(100);
      }
      assert.equal(ready, true);
      const bearers: string[] = [];
      for (const base of [nodeBase, origin]) {
        const token: Response = await fetch(`${base}/api/auth/token`, {
          headers: { cookie: actor.sessionCookie, origin: "http://127.0.0.1:5173" },
        });
        assert.equal(token.status, 200);
        const bearer = ((await token.json()) as { token: string }).token;
        bearers.push(bearer);
        const identity = await fetch(`${base}/v1/session`, {
          headers: { authorization: `Bearer ${bearer}` },
        });
        assert.equal(identity.status, 200);
        assert.equal(((await identity.json()) as { user: { role: string } }).user.role, "user");
        const workspace: Response = await fetch(`${base}/v1/workspaces`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            problemVersionId: actor.problemVersionId,
            language: actor.language,
          }),
        });
        assert.equal(workspace.status, 201);
      }
      await actor.dispose();
      actor = undefined;
      await sleep(3000);
      for (const [i, base] of [nodeBase, origin].entries())
        assert.equal(
          (
            await fetch(`${base}/v1/session`, {
              headers: { authorization: `Bearer ${bearers[i]}` },
            })
          ).status,
          401,
        );
      assert.equal(
        (await pool.query("SELECT display_name FROM users WHERE id=$1", [sentinel])).rows[0]
          .display_name,
        sentinel,
      );
      await pool.query("DELETE FROM users WHERE id=$1", [sentinel]);
    } finally {
      await actor?.dispose();
      if (worker && worker.exitCode === null) {
        const done = once(worker, "exit");
        worker.kill("SIGTERM");
        await done;
      }
      await runtime?.close();
      await pool.end();
    }
  },
);
