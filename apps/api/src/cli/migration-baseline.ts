/** @file migration-baseline.ts @description Provenance-bound legacy migration baseline. @module cli */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { createNodePool } from "@quorem/database/core";
import {
  baselineLegacy,
  type BaselineEvidence,
  type MigrationOwner,
  type VerifiedArtifact,
} from "@quorem/database/migrations";
import { verifyMigrationArtifact } from "../../../../scripts/hono-migration-artifact.mjs";
import { verifiedOperator } from "./operator-backfill.ts";
import { operatorDatabaseIdentity } from "./operator-database.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type Request = (path: string) => Promise<unknown>;
type Fence = (client: PoolClient, evidence: BaselineEvidence) => Promise<void>;
export async function runMigrationBaseline(
  options: {
    pool: Pool;
    owner: MigrationOwner;
    runId: string;
    operator: string;
    issuer: string;
    operationId: string;
    reason: string;
    apply: boolean;
  },
  dependencies: { request?: Request; fence?: Fence } = {},
) {
  const { pool, owner, runId, operator, issuer, operationId, reason, apply } = options;
  if (
    !["product", "auth"].includes(owner) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      operationId,
    ) ||
    !operator.trim() ||
    !issuer.trim() ||
    !reason.trim()
  )
    throw new Error("Invalid baseline operation");
  if (apply && !dependencies.fence) throw new Error("Authoritative writer fence required");
  const ledger = owner === "product" ? "public.schema_migrations" : "quorem_auth.schema_migrations";
  const client = await pool.connect();
  let names: string[];
  try {
    await client.query("BEGIN");
    const actor = await verifiedOperator(drizzle(client), issuer);
    if (actor !== operator) throw new Error("Operator mismatch");
    const rows = await client.query<{ name: string }>(
      `SELECT name FROM ${ledger} ORDER BY name LIMIT 513`,
    );
    if (!rows.rows.length || rows.rows.length > 512)
      throw new Error("Invalid migration ledger size");
    names = rows.rows.map((row) => row.name);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const provenance = await verifyMigrationArtifact({
    runId,
    productNames: owner === "product" ? names : [],
    authNames: owner === "auth" ? names : [],
    request: dependencies.request,
  });
  const directory = resolve(
    root,
    owner === "product" ? "apps/api/migrations" : "apps/auth/migrations",
  );
  const files: Record<string, string> = {};
  for (const name of names) {
    const path = `${owner === "product" ? "apps/api/migrations" : "apps/auth/migrations"}/${name}`;
    const expected = provenance.files[path];
    if (!expected || sha(await readFile(resolve(directory, name))) !== expected)
      throw new Error("Local migration artifact mismatch");
    files[name] = expected;
  }
  const artifact: VerifiedArtifact = {
    owner,
    repository: `${provenance.owner}/${provenance.repository}`,
    workflow: provenance.workflow,
    runId: provenance.runId,
    commitSha: provenance.commitSha,
    artifactDigest: provenance.artifactDigest,
    files,
  };
  const evidence: BaselineEvidence = { artifact, operationId, operator, reason };
  if (apply)
    await baselineLegacy(pool, owner, directory, evidence, async (tx, transactionEvidence) => {
      await dependencies.fence!(tx, transactionEvidence);
      const actor = await verifiedOperator(drizzle(tx), issuer);
      if (actor !== transactionEvidence.operator) throw new Error("Operator mismatch");
      const fingerprint = sha(JSON.stringify([issuer, transactionEvidence]));
      await tx.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'migrations.baseline',$3,$4) ON CONFLICT (operation_id) DO NOTHING",
        [operationId, actor, fingerprint, reason],
      );
      const prior = await tx.query<{
        actor: string;
        user_id: string;
        action: string;
        scope: string;
        reason: string;
      }>(
        "SELECT actor,user_id,action,scope,reason FROM access_audit WHERE operation_id=$1 FOR UPDATE",
        [operationId],
      );
      const row = prior.rows[0];
      if (
        !row ||
        row.actor !== actor ||
        row.user_id !== actor ||
        row.action !== "migrations.baseline" ||
        row.scope !== fingerprint ||
        row.reason !== reason
      )
        throw new Error("Operation ID already used");
    });
  return {
    owner,
    runId,
    commitSha: artifact.commitSha,
    artifactDigest: artifact.artifactDigest,
    migrationCount: names.length,
    applied: apply,
  };
}
export async function migrationBaseline(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      owner: { type: "string" },
      "run-id": { type: "string" },
      "op-id": { type: "string" },
      operator: { type: "string" },
      reason: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (values.apply) throw new Error("Standalone apply has no authoritative writer fence");
  const database = process.env.QUOREM_OPERATOR_DATABASE_URL,
    issuer = process.env.AUTH_ORIGIN;
  if (
    !database ||
    !issuer ||
    !values.owner ||
    !values["run-id"] ||
    !values["op-id"] ||
    !values.operator ||
    !values.reason
  )
    throw new Error("Operator database and baseline evidence required");
  operatorDatabaseIdentity(database);
  const pool = createNodePool({
    connectionString: database,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  try {
    return await runMigrationBaseline({
      pool,
      owner: values.owner as MigrationOwner,
      runId: values["run-id"],
      operator: values.operator,
      issuer,
      operationId: values["op-id"],
      reason: values.reason,
      apply: false,
    });
  } finally {
    await pool.end();
  }
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await migrationBaseline(process.argv.slice(2))));
  } catch {
    console.error("Migration baseline failed");
    process.exitCode = 1;
  }
}
