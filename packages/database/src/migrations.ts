/** @file migrations.ts @description PostgreSQL schema and migration ownership. @module database */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";

export type MigrationOwner = "product" | "auth";
/** The deployment provenance owner authenticates this artifact before calling baseline. */
export interface VerifiedArtifact {
  owner: MigrationOwner;
  repository: string;
  workflow: string;
  runId: string;
  commitSha: string;
  artifactDigest: string;
  files: Readonly<Record<string, string>>;
}
export interface BaselineEvidence {
  artifact: VerifiedArtifact;
  operationId: string;
  operator: string;
  reason: string;
}
type Migration = { name: string; sql: string; checksum: string };
type LedgerRow = { name: string; checksum: string | null };
type BaselineRow = LedgerRow & {
  baseline_operation: string | null;
  baseline_operator: string | null;
  baseline_reason: string | null;
  baseline_artifact: string | null;
};
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function source(directory: string, owner: MigrationOwner): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  if (!names.length) throw new Error(`No ${owner} SQL migrations found`);
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(join(directory, name));
      return {
        name,
        sql: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        checksum: digest(bytes),
      };
    }),
  );
}
async function prepare(client: PoolClient, owner: MigrationOwner): Promise<string> {
  await client.query(
    owner === "auth"
      ? "SELECT pg_advisory_xact_lock(714901, 1)"
      : "SELECT pg_advisory_xact_lock(740010)",
  );
  if (owner === "auth") {
    const existing = await client.query(
      "SELECT to_regclass('quorem_auth.schema_migrations') AS ledger, to_regclass('quorem_auth.user') AS users",
    );
    if (!existing.rows[0].ledger && existing.rows[0].users)
      throw new Error(
        "Existing auth schema has no migration ledger; use a fresh database or migrate it explicitly",
      );
    await client.query("CREATE SCHEMA IF NOT EXISTS quorem_auth");
  }
  const ledger = owner === "auth" ? "quorem_auth.schema_migrations" : "public.schema_migrations";
  await client.query(`CREATE TABLE IF NOT EXISTS ${ledger}(name text PRIMARY KEY)`);
  await client.query(
    `ALTER TABLE ${ledger} ADD COLUMN IF NOT EXISTS checksum text, ADD COLUMN IF NOT EXISTS baseline_operation text, ADD COLUMN IF NOT EXISTS baseline_operator text, ADD COLUMN IF NOT EXISTS baseline_reason text, ADD COLUMN IF NOT EXISTS baseline_artifact text`,
  );
  return ledger;
}
function prefix(files: Migration[], rows: LedgerRow[], owner: MigrationOwner): void {
  const available = new Set(files.map((file) => file.name));
  for (const row of rows)
    if (!available.has(row.name))
      throw new Error(`Database has unavailable ${owner} migration ${row.name}`);
  const applied = new Set(rows.map((row) => row.name));
  let missing = false;
  for (const file of files) {
    if (!applied.has(file.name)) missing = true;
    else if (missing) throw new Error(`${owner} migration history is not a contiguous prefix`);
  }
}
function checkedHistory(files: Migration[], rows: LedgerRow[], owner: MigrationOwner) {
  prefix(files, rows, owner);
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));
  for (const file of files)
    if (applied.has(file.name)) {
      const prior = applied.get(file.name);
      if (!prior) throw new Error(`${owner} migration history requires an audited baseline`);
      if (prior !== file.checksum)
        throw new Error(`${owner} migration checksum mismatch: ${file.name}`);
    }
  return applied;
}
/** Caller holds the migration locks and transaction throughout verification. */
export async function verifyCompleteHistory(
  client: PoolClient,
  owner: MigrationOwner,
  directory: string,
): Promise<void> {
  const files = await source(directory, owner);
  const ledger = owner === "auth" ? "quorem_auth.schema_migrations" : "public.schema_migrations";
  const rows = (await client.query<LedgerRow>(`SELECT name,checksum FROM ${ledger}`)).rows;
  checkedHistory(files, rows, owner);
  if (rows.length !== files.length) throw new Error(`Incomplete ${owner} migration history`);
}
/** Hash and verify all committed history before executing any pending SQL. */
export async function migrate(pool: Pool, owner: MigrationOwner, directory: string): Promise<void> {
  const files = await source(directory, owner);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ledger = await prepare(client, owner);
    const rows = (await client.query<LedgerRow>(`SELECT name,checksum FROM ${ledger} FOR UPDATE`))
      .rows;
    const applied = checkedHistory(files, rows, owner);
    for (const file of files) {
      if (applied.has(file.name)) continue;
      try {
        await client.query(file.sql);
      } catch (error) {
        throw new Error(`migration ${file.name} failed`, { cause: error });
      }
      await client.query(`INSERT INTO ${ledger}(name,checksum) VALUES($1,$2)`, [
        file.name,
        file.checksum,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
/** Only a provenance verifier and transactional operator-authority owner may call this path. */
export async function baselineLegacy(
  pool: Pool,
  owner: MigrationOwner,
  directory: string,
  evidence: BaselineEvidence,
  authorizeAndAudit: (client: PoolClient, evidence: BaselineEvidence) => Promise<void>,
): Promise<void> {
  const files = await source(directory, owner);
  const a = evidence.artifact;
  if (
    typeof authorizeAndAudit !== "function" ||
    a.owner !== owner ||
    !/^[a-f0-9]{40}$/.test(a.commitSha) ||
    !/^[a-f0-9]{64}$/.test(a.artifactDigest) ||
    !/^[0-9]+$/.test(a.runId) ||
    !/^[^/\s]+\/[^/\s]+$/.test(a.repository) ||
    !/^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/.test(a.workflow) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      evidence.operationId,
    ) ||
    typeof evidence.operator !== "string" ||
    !evidence.operator.trim() ||
    typeof evidence.reason !== "string" ||
    !evidence.reason.trim()
  )
    throw new Error("Invalid baseline evidence");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ledger = await prepare(client, owner);
    const rows = (
      await client.query<BaselineRow>(
        `SELECT name,checksum,baseline_operation,baseline_operator,baseline_reason,baseline_artifact FROM ${ledger} FOR UPDATE`,
      )
    ).rows;
    prefix(files, rows, owner);
    if (!rows.length || Object.keys(a.files).length !== rows.length)
      throw new Error("Baseline requires an exact artifact manifest");
    const byName = new Map(files.map((file) => [file.name, file]));
    for (const row of rows)
      if (
        !/^[a-f0-9]{64}$/.test(a.files[row.name] ?? "") ||
        a.files[row.name] !== byName.get(row.name)?.checksum
      )
        throw new Error(`Baseline artifact mismatch: ${row.name}`);
    const artifact = JSON.stringify({
      repository: a.repository,
      workflow: a.workflow,
      runId: a.runId,
      commitSha: a.commitSha,
      artifactDigest: a.artifactDigest,
    });
    const legacy = rows.every(
      (row) =>
        row.checksum === null &&
        row.baseline_operation === null &&
        row.baseline_operator === null &&
        row.baseline_reason === null &&
        row.baseline_artifact === null,
    );
    const retry = rows.every(
      (row) =>
        row.checksum === a.files[row.name] &&
        row.baseline_operation === evidence.operationId &&
        row.baseline_operator === evidence.operator &&
        row.baseline_reason === evidence.reason &&
        row.baseline_artifact === artifact,
    );
    if (!legacy && !retry) throw new Error("Baseline history conflicts with this operation");
    await authorizeAndAudit(client, evidence);
    if (legacy)
      for (const row of rows)
        await client.query(
          `UPDATE ${ledger} SET checksum=$2,baseline_operation=$3,baseline_operator=$4,baseline_reason=$5,baseline_artifact=$6 WHERE name=$1`,
          [
            row.name,
            a.files[row.name],
            evidence.operationId,
            evidence.operator,
            evidence.reason,
            artifact,
          ],
        );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
