/** Operator-only maintenance; requires the deployed stage configuration and a persisted plan. */
import { createRequire } from "node:module";
import { mkdtemp, open, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { remoteSandbox } from "../apps/runner/src/sandbox/remote.ts";
import { stageControls } from "./hono-stage-controls.mjs";
import { stageDatabaseURL } from "./hono-stage-deploy-database.mjs";
import { validateStageRequest, terraformInitArgs } from "./hono-stage-deploy.mjs";
import { runStageCommand } from "./hono-stage-launch.mjs";
import { setQueue } from "./hono-stage-deploy-queue.mjs";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
import { readStageAttemptPage } from "./hono-stage-recovery-database.mjs";
import { maintenanceJournal } from "./hono-stage-maintenance-journal.mjs";
import { maintainStage, validateMaintenancePlan } from "./hono-stage-maintenance.mjs";

export async function runStageMaintenance(env, plan, directory) {
  validateMaintenancePlan(plan);
  if (env.HONO_STAGE_ACTION !== "maintenance")
    throw new Error("Explicit maintenance action required");
  const staged = { ...env, HONO_STAGE_ACTION: "stage", TF_VAR_enable_queue_consumer: "false" };
  validateStageRequest(staged);
  if (env.TF_VAR_case_namespace_id !== plan.namespace || env.TF_VAR_database_user !== plan.role)
    throw new Error("Maintenance configuration does not match deployed authority");
  const services = JSON.parse(env.TF_VAR_service_secrets),
    worker = JSON.parse(env.HONO_WORKER_SECRETS_JSON),
    hosts = JSON.parse(env.TF_VAR_hostnames),
    caseOrigin = `https://${hosts.case}`;
  const journal = await maintenanceJournal(directory, plan);
  const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
    "pg",
  );
  const database = new Client({
    connectionString: stageDatabaseURL(env),
    connectionTimeoutMillis: 5000,
    query_timeout: 35000,
  });
  database.on("error", () => {});
  const temp = await mkdtemp(join(tmpdir(), "quorem-maintenance-"));
  try {
    const publicKeyFile = join(temp, "case-public.pem");
    await writeFile(publicKeyFile, services.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM, { mode: 0o600 });
    const controls = await stageControls({
      namespace: plan.namespace,
      scope: plan.scope,
      release: plan.prior.release,
      bindings: plan.prior.bindings,
      secret: services.RECOVERY_CONTROL_SECRET,
      caseOrigin,
      runnerOrigin: `https://${hosts.drain}`,
      caseAccess: {
        id: services.QUOREM_CASE_ACCESS_CLIENT_ID,
        secret: services.QUOREM_CASE_ACCESS_CLIENT_SECRET,
      },
      runnerAccess: {
        id: worker.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
        secret: worker.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET,
      },
      publicKeyFile,
    });
    const sandbox = remoteSandbox({
      origin: caseOrigin,
      namespaceId: plan.namespace,
      secret: services.QUOREM_CASE_SECRET,
      ownerPublicKey: services.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
      cleanupMs: 30000,
      fetch: (url, init) => {
        if (new URL(url).origin !== caseOrigin) throw new Error("Unexpected maintenance transport");
        const headers = new Headers(init.headers);
        headers.set("CF-Access-Client-Id", services.QUOREM_CASE_ACCESS_CLIENT_ID);
        headers.set("CF-Access-Client-Secret", services.QUOREM_CASE_ACCESS_CLIENT_SECRET);
        return fetch(url, { ...init, headers });
      },
    });
    if (sandbox.scope !== plan.scope) throw new Error("Maintenance sandbox authority changed");
    await database.connect();
    return await maintainStage(plan, {
      journal,
      controls,
      database,
      detach: () => {
        runStageCommand("terraform", terraformInitArgs(staged, "hono-stage"), staged);
        return setQueue(staged, false);
      },
      fence: fenceStageRuntime,
      databasePage: readStageAttemptPage,
      teardown: (fence) => sandbox.teardownAttempt(fence),
    });
  } finally {
    await database.end().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      throw new Error("Maintenance plan and private journal directory required");
    const handle = await open(process.argv[2], "r");
    let raw;
    try {
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) throw new Error("Oversized maintenance plan");
      raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
    const receipt = await runStageMaintenance(process.env, JSON.parse(raw), process.argv[3]);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch {
    process.stderr.write(
      "Stage maintenance incomplete; preserve journal and retry the same plan. Sensitive output withheld.\n",
    );
    process.exitCode = 1;
  }
}
