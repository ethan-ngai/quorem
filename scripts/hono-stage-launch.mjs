/** Provision a fresh isolated stage; provider credentials and state never leave the job. */
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapResources as stageResources,
  StageCommandFailure,
  runStageCommand,
} from "./hono-stage-command.mjs";
import { stageIntent } from "./hono-stage-intent.mjs";
import { assembleStageConfig, createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { terraformInitArgs } from "./hono-stage-deploy.mjs";
import { publishImages } from "./hono-stage-deploy-images.mjs";
import { deployStage } from "./hono-stage-deploy-stage.mjs";
import { checkStageProvider } from "./hono-stage-provider-check.mjs";
import { requirePrivateStageState } from "./hono-stage-state.mjs";
import { stageNamespaceReady } from "./hono-stage-ready.mjs";
import { requireFreshStageResources } from "./hono-stage-freshness.mjs";
import { StageInitializationFailure } from "./hono-stage-initialization.mjs";
import { StageRoleFailure } from "./hono-stage-database-role.mjs";

const acceptanceFailures = new Set([
  "Stage token exchange failed",
  "Stage workspace creation failed",
  "Stage admission failed",
  "Stage drain failed",
  "Stage result unavailable",
  "Stage submission not accepted",
  "Authenticated ingress control failed",
  "Private ingress accepts invalid credentials",
  "Namespace changed",
  "Stage profile upload failed",
  "Stage profile read failed",
  "Stage profile cleanup failed",
  "Queue proof failed; consumer detached",
  "Queue proof failed and detachment is unconfirmed",
]);
export function stageAcceptanceReason(error) {
  for (const candidate of [error, error?.cause])
    if (acceptanceFailures.has(candidate?.message)) return candidate.message;
}

export function bootstrapEnvironment(env, secrets) {
  if (
    env.GITHUB_REF !== "refs/heads/feat/hono-migration" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Exact migration release required");
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !/^[a-z][a-z0-9-]{3,99}$/.test(env.NEON_PROJECT_ID ?? "") ||
    !/^[a-z0-9][a-z0-9-]{2,62}$/.test(env.TF_STATE_BUCKET ?? "")
  )
    throw new Error("Invalid stage backend");
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "NEON_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ])
    if (!env[name]) throw new Error(`Missing ${name}`);
  const names = [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "CI",
    "NODE_EXTRA_CA_CERTS",
    "CLOUDFLARE_API_TOKEN",
    "NEON_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  return {
    ...Object.fromEntries(
      names.filter((name) => env[name] !== undefined).map((name) => [name, env[name]]),
    ),
    TF_IN_AUTOMATION: "true",
    TF_VAR_project_id: env.NEON_PROJECT_ID,
    TF_VAR_neon_api_key: env.NEON_API_KEY,
    TF_VAR_stage_secrets: JSON.stringify(secrets),
  };
}
export async function launchStage(
  env,
  {
    action = "plan",
    state = requirePrivateStageState,
    run = runStageCommand,
    createSecrets = createStageSecrets,
    assemble = assembleStageConfig,
    images = publishImages,
    activate = deployStage,
    freshness = requireFreshStageResources,
    mask = () => {},
    report = () => {},
  } = {},
) {
  if (!["plan", "stage"].includes(action)) throw new Error("Invalid stage action");
  const child = bootstrapEnvironment(env, createSecrets());
  await checkStageProvider(env, { state, freshness, fresh: action === "stage", report });
  const directory = mkdtempSync(join(tmpdir(), "quorem-hono-bootstrap-"));
  chmodSync(directory, 0o700);
  const plan = join(directory, "bootstrap.tfplan");
  const prefix = ["-chdir=infra/terraform/hono-bootstrap"];
  try {
    run("terraform", terraformInitArgs(env, "hono-bootstrap"), child);
    let existing = "";
    try {
      existing = run("terraform", [...prefix, "state", "list"], child);
    } catch (error) {
      if (!(error instanceof StageCommandFailure) || !error.noState) throw error;
    }
    const resources = existing
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (resources.some((value) => !stageResources.includes(value)))
      throw new Error("Unexpected bootstrap state");
    report("bootstrap-state", { resources });
    run(
      "terraform",
      [...prefix, "plan", "-input=false", "-no-color", "-lock-timeout=5m", `-out=${plan}`],
      child,
    );
    chmodSync(plan, 0o600);
    const view = JSON.parse(run("terraform", [...prefix, "show", "-json", plan], child));
    if (!Array.isArray(view.resource_changes)) throw new Error("Bootstrap plan unavailable");
    const allowed = new Set(stageResources);
    const summary = (change) => ({
      address: allowed.has(change.address) ? change.address : "unexpected",
      actions: Array.isArray(change.change?.actions)
        ? change.change.actions.map((action) =>
            ["no-op", "create", "read", "update", "delete"].includes(action)
              ? action
              : "unexpected",
          )
        : [],
    });
    report("bootstrap-plan", view.resource_changes.map(summary));
    report("bootstrap-drift", (view.resource_drift ?? []).map(summary));
    for (const change of [...view.resource_changes, ...(view.resource_drift ?? [])]) {
      const observedRefresh =
        (view.resource_drift ?? []).includes(change) &&
        change.address === "restapi_object.stage_branch" &&
        JSON.stringify(change.change?.actions) === '["update"]' &&
        typeof change.change?.before?.id === "string" &&
        change.change.before.id === change.change.after?.id &&
        change.change.before.data === change.change.after?.data &&
        view.resource_changes.some(
          (planned) =>
            planned.address === change.address &&
            JSON.stringify(planned.change?.actions) === '["no-op"]',
        );
      if (
        !allowed.has(change.address) ||
        !Array.isArray(change.change?.actions) ||
        (!observedRefresh &&
          change.change.actions.some((value) => !["no-op", "create", "read"].includes(value))) ||
        (change.address.startsWith("data.") &&
          change.change.actions.some((value) => !["no-op", "read"].includes(value)))
      )
        throw new Error("Bootstrap plan includes unrelated or destructive changes");
    }
    if (action === "plan")
      return {
        status: "planned",
        resources: view.resource_changes.map((change) => ({
          address: change.address,
          actions: change.change.actions,
        })),
      };
    run(
      "terraform",
      [...prefix, "apply", "-input=false", "-no-color", "-lock-timeout=5m", plan],
      child,
    );
    const bootstrap = JSON.parse(run("terraform", [...prefix, "output", "-json"], child));
    const hide = (value) => {
      if (typeof value === "string") {
        mask(value);
        if (value.startsWith("postgres")) {
          try {
            mask(decodeURIComponent(new URL(value).password));
          } catch {}
        }
      } else if (value && typeof value === "object")
        for (const item of Object.values(value)) hide(item);
    };
    hide(bootstrap);
    const configured = assemble(bootstrap, env);
    // Publish once before the migration boundary; only real registry digests enter Terraform.
    report("publish-images");
    const published = await Promise.resolve(images(configured));
    const prepared = {
      ...configured,
      TF_VAR_runner_image: published.runner,
      TF_VAR_verifier_image: published.verifier,
      TF_VAR_image_service_image: published.image,
      TF_VAR_case_images: JSON.stringify(
        Object.fromEntries(
          ["python", "java", "typescript", "ocaml", "postgresql"].map((name) => [
            name,
            published[name],
          ]),
        ),
      ),
    };
    return await activate(prepared, {
      images: () => published,
      probe: stageNamespaceReady,
      phase: report,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = stageIntent(process.env);
    const receipt = await launchStage(process.env, {
      action,
      report(phase, resources) {
        process.stdout.write(`${JSON.stringify({ phase, ...(resources ? { resources } : {}) })}\n`);
      },
      mask(value) {
        if (value.length >= 8)
          process.stdout.write(
            `::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`,
          );
      },
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    const role =
      error instanceof StageRoleFailure
        ? error
        : error.cause instanceof StageRoleFailure
          ? error.cause
          : undefined;
    const command =
      error instanceof StageCommandFailure
        ? error
        : error.cause instanceof StageCommandFailure
          ? error.cause
          : undefined;
    const acceptance = stageAcceptanceReason(error);
    process.stderr.write(
      `${acceptance ? JSON.stringify({ error: "stage-acceptance", reason: acceptance, status: Number.isInteger(error.status ?? error.cause?.status) ? (error.status ?? error.cause?.status) : undefined }) : role ? JSON.stringify({ error: "stage-runtime-role", phase: role.phase, code: role.code, flags: role.flags, reason: role.reason }) : command ? JSON.stringify({ error: "stage-command", category: command.category, resources: command.resources, diagnostics: command.diagnostics, validation: command.validation, uploadPhase: command.uploadPhase }) : error instanceof StageInitializationFailure ? JSON.stringify({ error: "stage-initialization", reason: error.reason }) : "Isolated stage launch failed; sensitive output withheld"}\n`,
    );
    process.exitCode = 1;
  }
}
