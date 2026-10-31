/** @file fixture.ts @description Reset and seed a dedicated runtime validation database. @module runtime */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { seedCatalog } from "../../cli/seed.ts";
import { assertRuntimeFixture } from "./fixture-guard.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
/** Hold an exclusive session lock throughout validation; only the named disposable DB is reset. */
export async function bootstrapRuntimeFixture(url: string): Promise<() => Promise<void>> {
  assertRuntimeFixture(url);
  const pool = createNodePool({
    connectionString: url,
    max: 3,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const client = await pool.connect().catch(async (error) => {
    await pool.end();
    throw error;
  });
  let locked = false;
  const reset = async () => {
    await client.query(
      "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
    );
  };
  try {
    const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
    if (database !== "quorem_hono_runtime_test")
      throw new Error("Disposable runtime database required");
    locked = (await client.query("SELECT pg_try_advisory_lock(740037, 1) AS locked")).rows[0]
      .locked;
    if (!locked) throw new Error("Runtime fixture database is already in use");
    await reset();
    await migrate(pool, "product", resolve(root, "apps/api/migrations"));
    await migrate(pool, "auth", resolve(root, "apps/auth/migrations"));
    await seedCatalog(pool, true);
    await pool.query(
      "INSERT INTO users(id,display_name,role) VALUES('runtime-fixture-operator','Fixture Operator','admin')",
    );
    await pool.query(
      `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('runtime-fixture-subject','Fixture Operator','operator@example.test',true,clock_timestamp(),clock_timestamp())`,
    );
    await pool.query(
      "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('http://127.0.0.1:8765','runtime-fixture-subject','runtime-fixture-operator')",
    );
    await pool.query(
      "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator','runtime-fixture-operator','runtime-fixture-operator','operator.bootstrap','runtime-fixture-subject','Disposable runtime fixture')",
    );
    return async () => {
      try {
        await reset();
      } finally {
        try {
          await client.query("SELECT pg_advisory_unlock(740037, 1)");
        } finally {
          client.release();
          await pool.end();
        }
      }
    };
  } catch (error) {
    try {
      if (locked) {
        try {
          await reset();
        } finally {
          await client.query("SELECT pg_advisory_unlock(740037, 1)");
        }
      }
    } finally {
      client.release();
      await pool.end();
    }
    throw error;
  }
}
