/** @file hono-production-terraform.mjs @description Reviewed production Terraform mutations. @module deployment */
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";
import { plannedResourceChanges } from "./hono-terraform-plan.mjs";

export function inspectProductionPlan(plan, mode) {
  const changes = plannedResourceChanges(plan);
  for (const item of changes) {
    const actions = item.change?.actions;
    if (!Array.isArray(actions)) throw new Error("Invalid production plan actions");
    if (actions.join() === "no-op" || (item.mode === "data" && actions.join() === "read")) continue;
    if (mode === "routes") {
      if (
        !/^cloudflare_workers_route\.api\[/.test(item.address) ||
        actions.join() !== "update" ||
        item.change.after?.script !== "quorem-hono-production"
      )
        throw new Error("Route plan includes unrelated mutation");
    } else if (mode === "legacy-stop") {
      if (
        actions.join() !== "delete" ||
        !/^(cloudflare_worker\.app|cloudflare_worker_version\.app|cloudflare_queue(?:_consumer)?\.(?:judge|judge_dead_letter)|random_password\.judge_control|restapi_object\.(?:container|rollout|judge_container|judge_rollout|fast_judge_container|case_container)|terraform_data\.fast_worker_version)$/.test(
          item.address,
        )
      )
        throw new Error("Legacy shutdown includes unrelated mutation");
    } else if (mode === "rehearsal-cleanup") {
      if (item.address !== "restapi_object.rehearsal[0]" || actions.join() !== "delete")
        throw new Error("Rehearsal cleanup includes unrelated mutation");
    } else if (
      actions.includes("delete") &&
      !(
        actions.includes("create") &&
        /^(cloudflare_worker_version\.services|terraform_data\.case_images|restapi_object\.trusted_rollout\[)/.test(
          item.address,
        )
      )
    )
      throw new Error("Native provisioning would delete retained resources");
  }
  return changes.map((item) => ({ address: item.address, actions: item.change.actions }));
}

export async function productionTerraform(env, directory, key, options = {}) {
  runStageCommand("terraform", terraformBackendArgs(env, directory, key), env);
  const temporary = await mkdtemp(join(tmpdir(), "quorem-production-plan-"));
  const plan = join(temporary, "reviewed.tfplan");
  try {
    runStageCommand(
      "terraform",
      [
        `-chdir=infra/terraform/${directory}`,
        "plan",
        "-input=false",
        "-no-color",
        "-lock-timeout=5m",
        ...(options.destroy ? ["-destroy"] : []),
        ...(options.targets ?? []).map((name) => `-target=${name}`),
        `-out=${plan}`,
      ],
      env,
    );
    await chmod(plan, 0o600);
    const value = JSON.parse(
      runStageCommand(
        "terraform",
        [`-chdir=infra/terraform/${directory}`, "show", "-json", plan],
        env,
      ),
    );
    const changes = inspectProductionPlan(value, options.mode ?? "provision");
    console.log(JSON.stringify({ phase: options.label ?? directory, changes }));
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
      env,
    );
    return JSON.parse(
      runStageCommand("terraform", [`-chdir=infra/terraform/${directory}`, "output", "-json"], env),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
