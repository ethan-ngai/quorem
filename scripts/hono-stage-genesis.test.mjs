import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { provisionStageRole } from "./hono-stage-database-role.mjs";
import { createRequire } from "node:module";
import { readVerifiedCaseProbe, signedCaseProbe } from "../deploy/case-proof.js";
import { recordStageGenesis, verifyStageGenesis } from "./hono-stage-genesis.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
void test(
  "real stage genesis binds signed control, checksum, runtime privileges and retries",
  { timeout: 180000 },
  async () => {
    const fixture = (fn) =>
      withDisposablePostgres(
        { prefix: "quorem-stage-genesis", port: 55713, database: "quorem_hono_stage" },
        async ({ url, run }) => {
          for (const [owner, dir] of [
            ["product", "apps/api/migrations"],
            ["auth", "apps/auth/migrations"],
          ]) {
            await run(
              process.execPath,
              ["--experimental-strip-types", "packages/database/src/migrate.ts", owner, dir],
              { env: { ...process.env, DATABASE_URL: url } },
            );
          }
          const client = new Client({ connectionString: url });
          await client.connect();
          const runtimeUrl = new URL(url);
          runtimeUrl.username = "quorem_stage_runtime_aaaaaaaaaaaa";
          runtimeUrl.password = "fixture-password-with-at-least-32-characters";
          const runtime = new Client({ connectionString: runtimeUrl.href });
          try {
            await provisionStageRole(client, runtime, runtimeUrl.username, runtimeUrl.password);
            await fn(client);
          } finally {
            await client.end();
          }
        },
      );
    const role = "quorem_stage_runtime_aaaaaaaaaaaa",
      namespace = "1".repeat(64),
      scope = `remote:${"2".repeat(64)}`;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const operation = randomUUID(),
      release = "3".repeat(40),
      bindings = "4".repeat(64);
    const base = {
      databaseIdentity: "project:branch:quorem_hono_stage",
      namespace,
      scope,
      initialOperation: operation,
      initialRelease: release,
      bindings,
      role,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    };
    const proof = async (initialOperation = operation) => {
      const nonce = randomUUID();
      const response = await signedCaseProbe(
        {
          CASES: { idFromName: () => namespace },
          CASE_OWNER_PRIVATE_KEY: privateKey
            .export({ type: "pkcs8", format: "der" })
            .toString("base64"),
        },
        {
          kind: "control-state",
          scope,
          attempt: "control",
          nonce,
          value: {
            namespace,
            scope,
            initialOperation,
            initialRelease: release,
            generation: 0,
            paused: true,
            release: null,
            bindings: null,
            activationOperation: null,
            pauseOperation: null,
          },
        },
      );
      return { ...base, nonce, response };
    };
    await fixture(async (client) => {
      await client.query(
        "INSERT INTO execution_attempt_inventory(attempt_id,job_id,sandbox_scope) VALUES($1,$2,$3)",
        [randomUUID(), randomUUID(), scope],
      );
      await assert.rejects(recordStageGenesis(client, await proof()), /history/);
    });
    await fixture(async (client) => {
      const initial = await proof();
      const key = await crypto.subtle.importKey(
        "spki",
        publicKey.export({ type: "spki", format: "der" }),
        "Ed25519",
        false,
        ["verify"],
      );
      const { envelope } = await readVerifiedCaseProbe(initial.response, {
        publicKey: key,
        kind: "control-state",
        scope,
        attempt: "control",
        nonce: initial.nonce,
        expectedNamespace: namespace,
      });
      const first = await recordStageGenesis(client, { ...base, envelope });
      assert.deepEqual(await recordStageGenesis(client, await proof()), first);
      await assert.rejects(verifyStageGenesis(client, await proof()), /login remains enabled/);
      await client.query(`ALTER ROLE ${role} NOLOGIN`);
      assert.deepEqual(await verifyStageGenesis(client, await proof()), first);
      await assert.rejects(
        recordStageGenesis(client, { ...(await proof()), databaseIdentity: "different" }),
        /mismatch/,
      );
      await assert.rejects(recordStageGenesis(client, await proof(randomUUID())), /state/);
      await assert.rejects(client.query("DELETE FROM stage_genesis"), /immutable/);
      await assert.rejects(client.query("TRUNCATE stage_genesis"), /immutable/);
      await client.query(`SET ROLE ${role}`);
      for (const statement of [
        "SELECT * FROM stage_genesis",
        "INSERT INTO stage_genesis DEFAULT VALUES",
        "UPDATE stage_genesis SET singleton=true",
        "DELETE FROM stage_genesis",
        "TRUNCATE stage_genesis",
      ])
        await assert.rejects(client.query(statement), /permission denied/);
      await client.query("RESET ROLE");
      const otherKey = generateKeyPairSync("ed25519").publicKey.export({
        type: "spki",
        format: "pem",
      });
      await assert.rejects(
        verifyStageGenesis(client, { ...(await proof()), publicKeyPem: otherKey }),
        /Invalid case probe/,
      );
      await client.query(
        "ALTER TABLE execution_jobs DISABLE TRIGGER execution_attempt_inventory_record",
      );
      await assert.rejects(verifyStageGenesis(client, await proof()), /inventory guard/);
      await client.query(
        "ALTER TABLE execution_jobs ENABLE TRIGGER execution_attempt_inventory_record",
      );
      await client.query("ALTER TABLE stage_genesis DISABLE TRIGGER stage_genesis_immutable");
      await assert.rejects(verifyStageGenesis(client, await proof()), /genesis guard/);
      await client.query("ALTER TABLE stage_genesis ENABLE TRIGGER stage_genesis_immutable");
      await client.query("UPDATE schema_migrations SET checksum='bad'");
      await assert.rejects(verifyStageGenesis(client, await proof()), /checksum/);
    });
  },
);
