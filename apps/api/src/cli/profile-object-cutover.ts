/** @file profile-object-cutover.ts @description Audited bounded avatar object copying. @module cli */
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { profileObjectReferences } from "../../../auth/src/adapters/drizzle-profile-object-references.ts";
import { profileObjectS3 } from "../../../auth/src/adapters/profile-object-s3.ts";
import { s3ProfileStorage } from "../../../auth/src/adapters/s3-profile-storage.ts";
import { copyProfilePhotoPage } from "../../../auth/src/profile-object-cutover.ts";
import { verifiedOperator } from "./operator-backfill.ts";

export function profileObjectEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Invalid object store endpoint");
  return url;
}
function store(prefix: "SOURCE" | "DESTINATION") {
  const bucket = process.env[`PROFILE_COPY_${prefix}_BUCKET`],
    endpoint = process.env[`PROFILE_COPY_${prefix}_ENDPOINT`];
  const accessKeyId = process.env[`PROFILE_COPY_${prefix}_ACCESS_KEY_ID`],
    secretAccessKey = process.env[`PROFILE_COPY_${prefix}_SECRET_ACCESS_KEY`];
  if (!bucket || !endpoint || Boolean(accessKeyId) !== Boolean(secretAccessKey))
    throw new Error("Invalid object store configuration");
  const url = profileObjectEndpoint(endpoint);
  return {
    bucket,
    endpoint: url.origin,
    config: {
      region: process.env[`PROFILE_COPY_${prefix}_REGION`] || "auto",
      endpoint: url.origin,
      forcePathStyle: true,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    },
  };
}
/** Explicit TLS and routing prevent a resume cursor crossing databases. */
export function cutoverDatabaseIdentity(value: string): readonly string[] {
  const url = new URL(value);
  const params = [...url.searchParams.entries()];
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname ||
    url.pathname === "/" ||
    url.hash ||
    params.length !== 1 ||
    params[0][0] !== "sslmode" ||
    !["verify-full", ...(local ? ["disable"] : [])].includes(params[0][1])
  )
    throw new Error("Operator database requires explicit safe routing and TLS");
  return [url.protocol, url.hostname, url.port || "5432", url.pathname, params[0][1]];
}
export async function profileObjectCutover(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "resume-file": { type: "string" },
      reason: { type: "string" },
      limit: { type: "string", default: "16" },
      "max-batches": { type: "string", default: "100" },
    },
  });
  const limit = Number(values.limit),
    maxBatches = Number(values["max-batches"]),
    file = values["resume-file"],
    reason = values.reason;
  const database = process.env.QUOREM_OPERATOR_DATABASE_URL,
    issuer = process.env.AUTH_ORIGIN;
  if (
    !file ||
    !reason ||
    !database ||
    !issuer ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 64 ||
    !Number.isInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > 1000
  )
    throw new Error("Operator, reason, resume file and bounded batches required");
  const source = store("SOURCE"),
    destination = store("DESTINATION");
  if (source.bucket === destination.bucket && source.endpoint === destination.endpoint)
    throw new Error("Source and destination must differ");
  const databaseIdentity = cutoverDatabaseIdentity(database);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        databaseIdentity,
        issuer,
        source.endpoint,
        source.bucket,
        destination.endpoint,
        destination.bucket,
        values.apply,
      ]),
    )
    .digest("hex");
  let cursor: string | undefined;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Resume file must be private");
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (
      saved.fingerprint !== fingerprint ||
      (saved.cursor !== null && typeof saved.cursor !== "string") ||
      saved.complete === true
    )
      throw new Error("Invalid or completed resume file");
    cursor = saved.cursor ?? undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const pool = createNodePool({
    connectionString: database,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
  const refs = profileObjectReferences(run),
    sourceStore = s3ProfileStorage(source.bucket, source.config),
    target = profileObjectS3(destination.bucket, destination.config);
  let checked = 0,
    missing = 0,
    copied = 0,
    complete = false;
  try {
    for (let i = 0; i < maxBatches; i++) {
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          const actor = await verifiedOperator(tx, issuer);
          await tx.execute(
            sql`INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES(${`profile-object:${randomUUID()}`},${actor},${actor},${values.apply ? "profile.objects.copy" : "profile.objects.audit"},${fingerprint},${reason})`,
          );
        }),
      );
      const page = await copyProfilePhotoPage({
        references: refs,
        source: sourceStore,
        destination: target,
        digest: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
        cursor,
        limit,
        apply: values.apply!,
      });
      checked += page.checked;
      missing += page.missing;
      copied += page.copied;
      cursor = page.next;
      complete = page.complete;
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ fingerprint, cursor: cursor ?? null, complete }),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, file);
      if (complete) break;
    }
    return { checked, missing, copied, complete, cutoverReady: false };
  } finally {
    await pool.end();
  }
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await profileObjectCutover(process.argv.slice(2))));
  } catch {
    console.error("Profile object cutover failed; resume file retained");
    process.exitCode = 1;
  }
}
