/** Provision a fresh isolated stage; provider credentials and state never leave the job. */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleStageConfig, createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { terraformInitArgs } from "./hono-stage-deploy.mjs";
import { publishImages } from "./hono-stage-deploy-images.mjs";
import { deployStage } from "./hono-stage-deploy-stage.mjs";
import { requirePrivateStageState } from "./hono-stage-state.mjs";
import { stageNamespaceReady } from "./hono-stage-ready.mjs";
import { requireFreshStageResources } from "./hono-stage-freshness.mjs";

function command(program, args, env) {
  const result = spawnSync(program, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const category =
      /permission|unauthorized|forbidden|authentication|access denied|\b403\b|\b401\b/i.test(
        result.stderr ?? "",
      )
        ? "provider permission"
        : /quota|rate.limit|\b429\b/i.test(result.stderr ?? "")
          ? "provider limit"
          : "configuration/provider";
    throw new Error(`Stage command failed (${category}); output withheld`);
  }
  return result.stdout ?? "";
}
export function bootstrapEnvironment(env, secrets) {
  if (
    env.GITHUB_REF !== "refs/heads/feat/hono-migration" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Exact migration release required");
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
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
    TF_VAR_account_id: env.CLOUDFLARE_ACCOUNT_ID,
    TF_VAR_stage_secrets: JSON.stringify(secrets),
  };
}
/** A source-controlled request triggers only this staging workflow, never production deployment. */
export function validateStageIntent(env, request) {
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    if (
      !["plan", "stage"].includes(env.HONO_BOOTSTRAP_ACTION) ||
      env.HONO_RELEASE_SHA !== env.GITHUB_SHA
    )
      throw new Error("Exact stage request required");
    return env.HONO_BOOTSTRAP_ACTION;
  }
  if (
    env.GITHUB_EVENT_NAME !== "push" ||
    !request ||
    Object.keys(request).sort().join() !== "action,operation" ||
    request.action !== "stage" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      request.operation ?? "",
    )
  )
    throw new Error("Explicit stage intent required");
  return "stage";
}
export async function launchStage(
  env,
  {
    action = "plan",
    state = requirePrivateStageState,
    run = command,
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
  await state(env);
  if (action === "stage")
    await freshness({
      ...env,
      TF_VAR_worker_name: "quorem-hono-stage",
      HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
    });
  const directory = mkdtempSync(join(tmpdir(), "quorem-hono-bootstrap-"));
  chmodSync(directory, 0o700);
  const plan = join(directory, "bootstrap.tfplan");
  const prefix = ["-chdir=infra/terraform/hono-bootstrap"];
  try {
    run("terraform", terraformInitArgs(env, "hono-bootstrap"), child);
    run(
      "terraform",
      [...prefix, "plan", "-input=false", "-no-color", "-lock-timeout=5m", `-out=${plan}`],
      child,
    );
    chmodSync(plan, 0o600);
    const view = JSON.parse(run("terraform", [...prefix, "show", "-json", plan], child));
    if (!Array.isArray(view.resource_changes)) throw new Error("Bootstrap plan unavailable");
    const allowed = new Set([
      "neon_project.stage",
      "terraform_data.stage_secrets",
      ...["runner_api", "verifier_api", "drain", "verifier", "case", "image"].map(
        (name) => `cloudflare_zero_trust_access_service_token.stage["${name}"]`,
      ),
    ]);
    for (const change of [...view.resource_changes, ...(view.resource_drift ?? [])]) {
      if (
        !allowed.has(change.address) ||
        !Array.isArray(change.change?.actions) ||
        change.change.actions.some((value) => !["no-op", "create", "read"].includes(value))
      )
        throw new Error("Bootstrap plan includes unrelated or destructive changes");
    }
    report(
      "bootstrap-plan",
      view.resource_changes.map((change) => ({
        address: change.address,
        actions: change.change.actions,
      })),
    );
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
    const action = validateStageIntent(
      process.env,
      process.env.GITHUB_EVENT_NAME === "push"
        ? JSON.parse(readFileSync("deploy/hono/stage-request.json", "utf8"))
        : undefined,
    );
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
    process.stderr.write(
      `${error instanceof Error && error.message.startsWith("Stage command failed (") ? error.message : "Isolated stage launch failed; sensitive output withheld"}\n`,
    );
    process.exitCode = 1;
  }
}
