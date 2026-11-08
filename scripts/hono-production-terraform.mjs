/** @file hono-production-terraform.mjs @description Reviewed production Terraform mutations. @module deployment */
import { mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";
import { plannedResourceChanges } from "./hono-terraform-plan.mjs";
import { isDeepStrictEqual } from "node:util";
export const PRODUCTION_DATABASE_CONNECTIONS = 60;

/** Relay rollouts may replace only the digest, preserving configuration and service identity. */
function mailImageChange(item) {
  const rollout = item.address === 'restapi_object.trusted_rollout["mail"]';
  if (!rollout && item.address !== 'restapi_object.trusted["mail"]') return false;
  const action = item.change.actions.join();
  if (!(rollout ? ["create,delete", "delete,create"].includes(action) : action === "update"))
    return false;
  try {
    for (const field of rollout ? ["data"] : ["data", "update_data"]) {
      const before = JSON.parse(item.change.before[field]);
      const after = JSON.parse(item.change.after[field]);
      const key = rollout ? "target_configuration" : "configuration";
      const image = after[key].image;
      if (
        typeof image !== "string" ||
        !/^registry\.cloudflare\.com\/[a-f0-9]{32}\/quorem-hono-production-mail@sha256:[a-f0-9]{64}$/.test(
          image,
        )
      )
        return false;
      after[key].image = before[key].image;
      if (!isDeepStrictEqual(before, after)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function inspectProductionPlan(plan, mode) {
  const changes = plannedResourceChanges(plan);
  for (const item of changes) {
    const actions = item.change?.actions;
    if (!Array.isArray(actions)) throw new Error("Invalid production plan actions");
    if (actions.join() === "no-op" || (item.mode === "data" && actions.join() === "read")) continue;
    if (mode === "hyperdrive-capacity") {
      const { before, after } = item.change;
      const configuration = (value) =>
        Object.fromEntries(
          Object.entries(value ?? {}).filter(
            ([key]) =>
              !["origin_connection_limit", "created_on", "modified_on", "restarted_on"].includes(
                key,
              ),
          ),
        );
      if (
        item.address !== "cloudflare_hyperdrive_config.database" ||
        actions.join() !== "update" ||
        after?.name !== "quorem-hono-production-database" ||
        !Number.isSafeInteger(after.origin_connection_limit) ||
        after.origin_connection_limit < PRODUCTION_DATABASE_CONNECTIONS ||
        after.origin_connection_limit > 100 ||
        after.origin_connection_limit < before?.origin_connection_limit ||
        !isDeepStrictEqual(configuration(before), configuration(after))
      )
        throw new Error("Hyperdrive capacity plan includes unrelated mutation");
    } else if (mode === "private-workers") {
      const action = actions.join();
      const retired = /^restapi_object\.trusted(?:_rollout)?\["(?:runner|verifier)"\]$/.test(
        item.address,
      );
      const versioned =
        /^(cloudflare_worker_version\.(?:services|verifier)|terraform_data\.case_images)$/.test(
          item.address,
        );
      const { before, after } = item.change;
      const verifierWorker =
        item.address === "cloudflare_worker.verifier" && ["create", "update"].includes(action);
      const verifierDomain =
        item.address === 'cloudflare_workers_custom_domain.service["verifier"]' &&
        after?.hostname === "verifier-hono.quorem.app" &&
        after.service === "quorem-hono-services-production-verifier" &&
        (["create", "update"].includes(action) ||
          (action === "delete,create" &&
            before?.hostname === after.hostname &&
            before.service === "quorem-hono-services-production" &&
            before.zone_id === after.zone_id &&
            before.account_id === after.account_id));
      if (
        !(retired && action === "delete") &&
        !(versioned && ["create", "update", "delete,create", "create,delete"].includes(action)) &&
        !verifierWorker &&
        !verifierDomain &&
        !mailImageChange(item)
      ) {
        const error = new Error("Private Worker rollout includes unrelated mutation");
        if (/^[a-z_.\[\]"0-9-]+$/.test(item.address) && /^[a-z,]+$/.test(action))
          error.planChange = { address: item.address, action };
        throw error;
      }
    } else if (mode === "rehearsal-cleanup") {
      if (item.address !== "restapi_object.rehearsal[0]" || actions.join() !== "delete")
        throw new Error("Rehearsal cleanup includes unrelated mutation");
    } else if (
      actions.includes("delete") &&
      !(
        actions.includes("create") &&
        /^(cloudflare_worker_version\.(?:services|verifier)|terraform_data\.case_images|restapi_object\.trusted_rollout\[)/.test(
          item.address,
        )
      )
    )
      throw new Error("Native provisioning would delete retained resources");
  }
  return changes.map((item) => ({ address: item.address, actions: item.change.actions }));
}

export async function productionTerraform(env, directory, key, options = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "quorem-production-plan-"));
  const plan = join(temporary, "reviewed.tfplan");
  const child = { ...env },
    variables = {};
  try {
    // Large Terraform values exceed the process environment entry limit.
    for (const [name, value] of Object.entries(child)) {
      if (name.startsWith("TF_VAR_") && Buffer.byteLength(value) > 32768) {
        variables[name.slice(7)] = JSON.parse(value);
        delete child[name];
      }
    }
    const file = join(temporary, "inputs.tfvars.json");
    await writeFile(file, JSON.stringify(variables), { mode: 0o600 });
    runStageCommand("terraform", terraformBackendArgs(child, directory, key), child);
    runStageCommand(
      "terraform",
      [
        `-chdir=infra/terraform/${directory}`,
        "plan",
        "-input=false",
        "-no-color",
        "-lock-timeout=5m",
        `-var-file=${file}`,
        ...(options.destroy ? ["-destroy"] : []),
        ...(options.targets ?? []).map((name) => `-target=${name}`),
        `-out=${plan}`,
      ],
      child,
    );
    await chmod(plan, 0o600);
    const value = JSON.parse(
      runStageCommand(
        "terraform",
        [`-chdir=infra/terraform/${directory}`, "show", "-json", plan],
        child,
      ),
    );
    const changes = inspectProductionPlan(value, options.mode ?? "provision");
    console.log(JSON.stringify({ phase: options.label ?? directory, changes }));
    await options.beforeApply?.();
    runStageCommand(
      "terraform",
      [
        `-chdir=infra/terraform/${directory}`,
        "apply",
        "-input=false",
        "-no-color",
        "-lock-timeout=5m",
        plan,
      ],
      child,
    );
    return JSON.parse(
      runStageCommand(
        "terraform",
        [`-chdir=infra/terraform/${directory}`, "output", "-json"],
        child,
      ),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
