/** Preserve the independently verified first case-control authority for stage recovery. */
import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readVerifiedCaseProbe } from "../deploy/case-proof.js";
import { assertStageRuntimeFenced, stageRecoveryLockKey } from "./hono-stage-recovery-fence.mjs";

const hex = (n) => new RegExp(`^[a-f0-9]{${n}}$`);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const migration = new URL(
  "../apps/api/migrations/062_execution_attempt_inventory.sql",
  import.meta.url,
);
async function evidence(options, initial) {
  const {
    databaseIdentity,
    namespace,
    scope,
    initialOperation,
    initialRelease,
    bindings,
    publicKeyPem,
  } = options;
  let { nonce, response } = options;
  if (options.envelope) {
    const e = options.envelope;
    if (
      e.kind !== "control-state" ||
      e.scope !== scope ||
      e.namespace !== namespace ||
      e.attempt !== "control" ||
      typeof e.body !== "string" ||
      e.body.length > 1368 ||
      typeof e.signature !== "string"
    )
      throw new Error("Invalid stage genesis envelope");
    nonce = e.nonce;
    response = new Response(Buffer.from(e.body, "base64"), {
      status: 200,
      headers: { "x-quorem-owner-namespace": e.namespace, "x-quorem-owner-signature": e.signature },
    });
  }
  if (
    typeof databaseIdentity !== "string" ||
    Buffer.byteLength(databaseIdentity) < 1 ||
    Buffer.byteLength(databaseIdentity) > 512 ||
    !hex(64).test(namespace ?? "") ||
    namespace === "0".repeat(64) ||
    !/^remote:[a-f0-9]{64}$/.test(scope ?? "") ||
    !uuid.test(initialOperation ?? "") ||
    !hex(40).test(initialRelease ?? "") ||
    !hex(64).test(bindings ?? "") ||
    !uuid.test(nonce ?? "")
  )
    throw new Error("Invalid stage genesis binding");
  const spki = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  const key = await crypto.subtle.importKey("spki", spki, "Ed25519", false, ["verify"]);
  const proof = await readVerifiedCaseProbe(response, {
    publicKey: key,
    kind: "control-state",
    scope,
    attempt: "control",
    nonce,
    expectedNamespace: namespace,
  });
  if (
    proof.value.initialOperation !== initialOperation ||
    proof.value.initialRelease !== initialRelease ||
    (initial && (proof.value.generation !== 0 || !proof.value.paused))
  )
    throw new Error("Invalid stage genesis state");
  return {
    databaseIdentity,
    namespace,
    scope,
    initialOperation,
    initialRelease,
    bindings,
    ownerKey: createHash("sha256").update(spki).digest("hex"),
    checksum: createHash("sha256")
      .update(await readFile(migration))
      .digest("hex"),
    envelope: proof.envelope,
  };
}
async function transaction(client, options, initial) {
  const value = await evidence(options, initial);
  const db = { query: (text, values) => client.query({ text, values, query_timeout: 7000 }) };
  let begun = false;
  try {
    await db.query("BEGIN");
    begun = true;
    await db.query("SET LOCAL statement_timeout = '5s'");
    await db.query("SET LOCAL lock_timeout = '1s'");
    const lock = await db.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      [stageRecoveryLockKey],
    );
    if (!lock.rows[0]?.acquired) throw new Error("Stage recovery is already running");
    if (!initial) await assertStageRuntimeFenced(db, options.role);
    else {
      if (!/^quorem_stage_runtime_[a-f0-9]{12,32}$/.test(options.role ?? ""))
        throw new Error("Invalid stage runtime role");
      const identity = await db.query(
        `SELECT current_database() AS database, current_user AS operator, session_user AS session_operator, EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1 AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
        AND NOT has_any_column_privilege(oid,'public.stage_genesis','SELECT,INSERT,UPDATE,REFERENCES')
        AND NOT has_table_privilege(oid,'public.stage_genesis','DELETE,TRUNCATE,TRIGGER')
        AND NOT has_any_column_privilege(oid,'public.execution_attempt_inventory','SELECT,INSERT,UPDATE,REFERENCES')
        AND NOT has_table_privilege(oid,'public.execution_attempt_inventory','DELETE,TRUNCATE,TRIGGER')
        AND NOT pg_has_role(oid,(SELECT relowner FROM pg_class WHERE oid='public.stage_genesis'::regclass),'USAGE')) AS safe`,
        [options.role],
      );
      if (
        identity.rows[0]?.database !== "quorem_hono_stage" ||
        identity.rows[0]?.operator !== identity.rows[0]?.session_operator ||
        identity.rows[0]?.operator === options.role ||
        !identity.rows[0]?.safe
      )
        throw new Error("Invalid stage operator");
    }
    const guard =
      await db.query(`SELECT c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid=c.oid AND t.tgname='stage_genesis_immutable' AND t.tgenabled='O'
        AND p.oid='public.guard_stage_genesis()'::regprocedure AND p.proowner=c.relowner
    ) AS safe FROM pg_class c WHERE c.oid='public.stage_genesis'::regclass`);
    if (guard.rows[0]?.safe !== true) throw new Error("Stage genesis guard unavailable");
    const inventoryGuard = await db.query(`SELECT
      j.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND i.relowner=j.relowner AND
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=j.oid AND t.tgname='execution_attempt_inventory_record' AND t.tgenabled='O' AND p.oid='public.record_execution_attempt()'::regprocedure AND p.prosecdef AND p.proowner=j.relowner) AND
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=i.oid AND t.tgname='execution_attempt_inventory_immutable' AND t.tgenabled='O' AND p.oid='public.guard_execution_attempt_inventory()'::regprocedure AND p.proowner=i.relowner) AS safe
      FROM pg_class j, pg_class i WHERE j.oid='public.execution_jobs'::regclass AND i.oid='public.execution_attempt_inventory'::regclass`);
    if (inventoryGuard.rows[0]?.safe !== true) throw new Error("Stage inventory guard unavailable");
    const ledger = await db.query(
      "SELECT checksum FROM public.schema_migrations WHERE name='062_execution_attempt_inventory.sql'",
    );
    if (ledger.rows.length !== 1 || ledger.rows[0].checksum !== value.checksum)
      throw new Error("Stage inventory migration checksum mismatch");
    await db.query(
      "LOCK TABLE public.execution_jobs, public.execution_attempt_inventory, public.stage_genesis IN SHARE ROW EXCLUSIVE MODE",
    );
    const prior = (await db.query("SELECT * FROM public.stage_genesis")).rows;
    if (!prior.length && initial) {
      const empty = await db.query(
        "SELECT NOT EXISTS(SELECT 1 FROM public.execution_attempt_inventory) AND NOT EXISTS(SELECT 1 FROM public.execution_jobs WHERE attempt_id IS NOT NULL) AS empty",
      );
      if (!empty.rows[0]?.empty)
        throw new Error("Existing attempt history cannot establish genesis");
      await db.query(
        "INSERT INTO public.stage_genesis(database_identity,namespace,scope,initial_operation,initial_release,initial_bindings,owner_key_sha256,genesis_envelope,migration_062_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          value.databaseIdentity,
          value.namespace,
          value.scope,
          value.initialOperation,
          value.initialRelease,
          value.bindings,
          value.ownerKey,
          JSON.stringify(value.envelope),
          value.checksum,
        ],
      );
    } else {
      const row = prior[0];
      if (
        prior.length !== 1 ||
        row.database_identity !== value.databaseIdentity ||
        row.namespace !== value.namespace ||
        row.scope !== value.scope ||
        row.initial_operation !== value.initialOperation ||
        row.initial_release !== value.initialRelease ||
        row.initial_bindings !== value.bindings ||
        row.owner_key_sha256 !== value.ownerKey ||
        row.migration_062_sha256 !== value.checksum
      )
        throw new Error("Stage genesis mismatch");
      const saved = row.genesis_envelope;
      if (
        !saved ||
        saved.kind !== "control-state" ||
        saved.scope !== value.scope ||
        saved.namespace !== value.namespace ||
        saved.attempt !== "control" ||
        !uuid.test(saved.nonce ?? "") ||
        typeof saved.body !== "string" ||
        saved.body.length > 1368
      )
        throw new Error("Invalid stored genesis proof");
      const savedResponse = new Response(Buffer.from(saved.body, "base64"), {
        status: 200,
        headers: {
          "x-quorem-owner-namespace": saved.namespace,
          "x-quorem-owner-signature": saved.signature,
        },
      });
      const verified = await evidence(
        { ...options, envelope: undefined, nonce: saved.nonce, response: savedResponse },
        true,
      );
      if (verified.ownerKey !== value.ownerKey) throw new Error("Invalid stored genesis proof");
    }
    await db.query("COMMIT");
    begun = false;
    return {
      databaseIdentity: value.databaseIdentity,
      namespace: value.namespace,
      scope: value.scope,
      initialOperation: value.initialOperation,
      initialRelease: value.initialRelease,
      bindings: value.bindings,
      ownerKeySha256: value.ownerKey,
      migration062Sha256: value.checksum,
    };
  } catch (error) {
    if (begun) await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
/** Caller must establish independently that this is the first isolated namespace. */
export const recordStageGenesis = (client, options) => transaction(client, options, true);
/** Current signed state and the fenced database must still match the original authority. */
export const verifyStageGenesis = (client, options) => transaction(client, options, false);

/** Deployment bridge; the caller supplies observations captured immediately after initialize. */
export async function provisionStageGenesis(env, { namespace, scope, bindings, observation }) {
  const { stageDatabaseURL } = await import("./hono-stage-deploy-database.mjs");
  const { createRequire } = await import("node:module");
  const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
    "pg",
  );
  const { runner, cases, proofs } = observation ?? {};
  if (
    runner?.status !== "prepared" ||
    runner.generation !== 1 ||
    runner.release !== env.HONO_RELEASE_SHA ||
    runner.bindings !== bindings ||
    cases?.generation !== 0 ||
    cases.paused !== true ||
    cases.initialRelease !== env.HONO_RELEASE_SHA ||
    !Array.isArray(proofs)
  )
    throw new Error("Invalid initial control observation");
  const matching = proofs.filter((p) => p?.kind === "control-state");
  if (matching.length !== 1) throw new Error("Missing unique initial case proof");
  let secret;
  try {
    secret = JSON.parse(env.TF_VAR_service_secrets);
  } catch {
    throw new Error("Invalid service configuration");
  }
  const client = new Client({
    connectionString: stageDatabaseURL(env),
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    return await recordStageGenesis(client, {
      databaseIdentity: env.HONO_STAGE_DATABASE_IDENTITY,
      namespace,
      scope,
      initialOperation: cases.initialOperation,
      initialRelease: cases.initialRelease,
      bindings,
      role: env.TF_VAR_database_user,
      publicKeyPem: secret.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
      envelope: matching[0],
    });
  } finally {
    await client.end().catch(() => {});
  }
}
