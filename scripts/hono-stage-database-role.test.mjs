import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
import {
  deriveStageRole,
  provisionStageRole,
  stageRoleCredentials,
} from "./hono-stage-database-role.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const password = "fixture-only-secret-abcdefghijklmnopqrstuvwxyz";
const role = deriveStageRole("a".repeat(40), "1");
const nextRole = deriveStageRole("a".repeat(40), "2");
void test("role name binds release and migration login differs", () => {
  const env = {
    HONO_RELEASE_SHA: "a".repeat(40),
    TF_VAR_database_user: role,
    TF_VAR_database_password: password,
    HONO_STAGE_DATABASE_URL:
      "postgres://operator:fixture@db-stage.example.com/quorem_hono_stage?sslmode=verify-full",
    TF_VAR_database_host: "db-stage.example.com",
    TF_VAR_database_port: "5432",
  };
  assert.equal(stageRoleCredentials(env).role, role);
  assert.notEqual(role, nextRole);
  assert.notEqual(deriveStageRole("a".repeat(39) + "b", "1"), role);
  assert.ok(deriveStageRole("a".repeat(40), String(Number.MAX_SAFE_INTEGER)).length < 63);
  for (const value of ["0", "01", "-1", "9007199254740992", "1.0"])
    assert.throws(() => deriveStageRole("a".repeat(40), value));
  assert.throws(() => stageRoleCredentials({ ...env, TF_VAR_database_user: "operator" }));
  assert.throws(() => stageRoleCredentials({ ...env, TF_VAR_database_password: "short" }));
  assert.throws(() =>
    stageRoleCredentials({
      ...env,
      HONO_STAGE_DATABASE_URL: `postgres://operator:${password}@db-stage.example.com/quorem_hono_stage?sslmode=verify-full`,
    }),
  );
});
void test(
  "real migrated database enforces role and inventory boundary",
  { skip: !process.env.QUOREM_STAGE_ROLE_TEST_URL },
  async () => {
    const url = new URL(process.env.QUOREM_STAGE_ROLE_TEST_URL);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(["55597", "55598"].includes(url.port));
    assert.equal(url.pathname, "/quorem_hono_stage");
    const operator = new Client({ connectionString: url.href });
    const runtimeURL = new URL(url);
    runtimeURL.username = role;
    runtimeURL.password = password;
    const runtime = new Client({ connectionString: runtimeURL.href });
    await operator.connect();
    try {
      await operator.query("GRANT SELECT ON execution_attempt_inventory TO PUBLIC");
      await assert.rejects(
        provisionStageRole(
          operator,
          new Client({ connectionString: runtimeURL.href }),
          role,
          password,
        ),
      );
      await operator.query("REVOKE SELECT ON execution_attempt_inventory FROM PUBLIC");
      await operator.query(
        "ALTER TABLE execution_jobs DISABLE TRIGGER execution_attempt_inventory_record",
      );
      await assert.rejects(
        provisionStageRole(
          operator,
          new Client({ connectionString: runtimeURL.href }),
          role,
          password,
        ),
      );
      await operator.query(
        "ALTER TABLE execution_jobs ENABLE TRIGGER execution_attempt_inventory_record",
      );
      await provisionStageRole(operator, runtime, role, password);
      const login = new Client({ connectionString: runtimeURL.href });
      await login.connect();
      try {
        await assert.rejects(login.query("SELECT * FROM execution_attempt_inventory"));
        await assert.rejects(login.query("TRUNCATE execution_attempt_inventory"));
        await assert.rejects(login.query("SET ROLE postgres"));
        await assert.rejects(login.query("SELECT * FROM schema_migrations"));
        await assert.rejects(
          login.query(
            "ALTER TABLE execution_jobs DISABLE TRIGGER execution_attempt_inventory_record",
          ),
        );
        await assert.rejects(login.query("CREATE TABLE public.forbidden(id int)"));
        await login.query("SELECT * FROM users LIMIT 1");
        await login.query('SELECT * FROM quorem_auth."user" LIMIT 1');
      } finally {
        await login.end();
      }
      await fenceStageRuntime(operator, role);
      const nextURL = new URL(runtimeURL);
      nextURL.username = nextRole;
      await provisionStageRole(
        operator,
        new Client({ connectionString: nextURL.href }),
        nextRole,
        password,
      );
      const stale = new Client({ connectionString: runtimeURL.href });
      await assert.rejects(stale.connect());
      await stale.end().catch(() => {});
      await assert.rejects(
        provisionStageRole(
          operator,
          new Client({ connectionString: runtimeURL.href }),
          role,
          password,
        ),
      );
    } finally {
      await operator.end();
    }
  },
);

void test(
  "new role serves real auth and product commands",
  { skip: !process.env.QUOREM_STAGE_ROLE_TEST_URL, timeout: 120000 },
  async () => {
    const raw = new URL(process.env.QUOREM_STAGE_ROLE_TEST_URL);
    assert.equal(raw.hostname, "127.0.0.1");
    assert.ok(["55597", "55598"].includes(raw.port));
    assert.equal(raw.pathname, "/quorem_hono_stage");
    const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
      "pg",
    );
    const { seedCatalog } = await import("../apps/api/src/cli/seed.ts");
    const { startNodeRuntime } = await import("../apps/api/src/runtime/node.ts");
    const { createHmac, createHash, randomUUID } = await import("node:crypto");
    const { createServer } = await import("node:http");
    const { createNodePool, withNodeConnection } =
      await import("../packages/database/src/core/index.ts");
    const { postgresClaims } =
      await import("../apps/api/src/adapters/postgres/judging/worker/claim.ts");
    const { once } = await import("node:events");
    const operator = new Pool({ connectionString: raw.href });
    const runtimeURL = new URL(raw);
    runtimeURL.username = nextRole;
    runtimeURL.password = password;
    const authSecret = "local-runtime-fixture-secret-32-characters",
      user = `fixture-${randomUUID()}`,
      token = randomUUID();
    let runtime;
    const queue = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        res.writeHead(200, { "content-type": "application/x-amz-json-1.0" });
        res.end(
          JSON.stringify({
            MessageId: "fixture",
            MD5OfMessageBody: createHash("md5").update(body.MessageBody).digest("hex"),
          }),
        );
      });
    });
    queue.listen(0, "127.0.0.1");
    await once(queue, "listening");
    Object.assign(process.env, {
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "fixture",
      AWS_SECRET_ACCESS_KEY: "fixture",
    });
    try {
      await seedCatalog(operator, true);
      await operator.query(
        'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,NOW(),NOW())',
        [user, `${user}@example.test`],
      );
      await operator.query(
        'INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
        [randomUUID(), token, user],
      );
      runtime = await startNodeRuntime({
        ...process.env,
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://127.0.0.1:8765",
        AUTH_DATABASE_URL: runtimeURL.href,
        DATABASE_URL: runtimeURL.href,
        QUOREM_DATABASE_LISTEN_URL: runtimeURL.href,
        BETTER_AUTH_SECRET: authSecret,
        AUTH_INTERNAL_SECRET: "local-test-internal",
        QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
        MATCH_INVITE_KEY: "ab".repeat(32),
        EXECUTION_WAKE_PROVIDER: "sqs",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
        SQS_LOCAL_ENDPOINT: `http://127.0.0.1:${queue.address().port}`,
        PORT: "0",
        IDENTITY_MODE: "managed",
        GUEST_CREATION: "false",
        GUEST_ADMISSION: "true",
      });
      if (!runtime.server.listening) await once(runtime.server, "listening");
      const base = `http://127.0.0.1:${runtime.server.address().port}`;
      const signature = createHmac("sha256", authSecret).update(token).digest("base64");
      const auth = await fetch(`${base}/api/auth/token`, {
        headers: {
          cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
          origin: "http://127.0.0.1:5173",
        },
      });
      assert.equal(auth.status, 200);
      const bearer = (await auth.json()).token;
      const workspace = await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
          language: "python",
        }),
      });
      assert.equal(workspace.status, 201);
      const admitted = await fetch(`${base}/v1/submissions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({
          workspaceId: (await workspace.json()).id,
          kind: "run",
          source: "class Solution:\n def runWidths(self, values): return []\n",
        }),
      });
      assert.equal(admitted.status, 202);
      const pool = createNodePool({
        connectionString: runtimeURL.href,
        max: 2,
        connectionTimeoutMs: 2000,
        idleTimeoutMs: 1000,
        onIdleError() {},
      });
      try {
        const run = (fn) => withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
        const claims = postgresClaims(run, {
          inputProtocol: "manifest-v1",
          resumable: true,
          losslessCases: true,
          losslessResults: true,
        });
        const claimed = await claims.claimAfterTeardown(true, "scope-fixture", null);
        assert.ok(claimed);
        const recorded = await operator.query(
          "SELECT job_id::text,sandbox_scope FROM execution_attempt_inventory WHERE attempt_id=$1",
          [claimed.attemptId],
        );
        assert.deepEqual(recorded.rows[0], {
          job_id: claimed.jobId,
          sandbox_scope: "scope-fixture",
        });
      } finally {
        await pool.end();
      }
    } finally {
      await runtime?.close();
      await new Promise((resolve) => queue.close(resolve));
      await operator.end();
    }
  },
);
