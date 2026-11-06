/** @file hono-production-images.mjs @description Reuse verified immutable runtime images. @module deployment */
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";
import { publishImages } from "./hono-stage-deploy-images.mjs";
import { reusableNativeImages } from "./hono-native-image-reuse.mjs";
const source = "333e4c79b06f9b074b13ae4891a6df65f32bcc8f";
const runId = "41285899439";
export function productionImages(env, { reuseMail = false } = {}) {
  const run = JSON.parse(
    runStageCommand("gh", ["api", `repos/ethan-ngai/quorem/actions/runs/${runId}`], env),
  );
  if (
    run.conclusion !== "success" ||
    run.head_sha !== source ||
    run.path !== ".github/workflows/hono-stage-deploy.yaml"
  )
    throw new Error("Validated runtime provenance mismatch");
  runStageCommand(
    "git",
    [
      "diff",
      "--exit-code",
      source,
      "--",
      "pnpm-lock.yaml",
      "apps/runner/python",
      "apps/runner/java",
      "apps/runner/typescript",
      "apps/runner/ocaml",
      "apps/runner/postgres",
      "packages/execution",
      "packages/questions",
      "packages/database",
      "deploy/hono/services/Dockerfile.image",
      "apps/auth/src/image-service-main.ts",
      "apps/auth/src/image-service.ts",
      "apps/auth/src/adapters/sharp-image.ts",
    ],
    env,
  );
  const logs = runStageCommand("gh", ["run", "view", runId, "--log"], env);
  let receipt;
  for (const line of logs.split("\n")) {
    const start = line.indexOf('{"release":');
    if (start >= 0) {
      try {
        const value = JSON.parse(line.slice(start));
        if (value.release === source && value.images) receipt = value;
      } catch {}
    }
  }
  const images = {};
  for (const role of ["python", "java", "typescript", "ocaml", "postgresql", "image"]) {
    const value = receipt?.images?.[role];
    if (
      typeof value !== "string" ||
      !value.startsWith(`registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/`) ||
      !/@sha256:[a-f0-9]{64}$/.test(value)
    )
      throw new Error("Validated runtime image missing");
    images[role] = value;
  }
  if (reuseMail) return { ...images, mail: activeMailImage(env) };
  try {
    runStageCommand(
      "git",
      [
        "diff",
        "--exit-code",
        "a45a709096827b908dcb82f9ce6ab1b26e0729ec",
        "--",
        "apps/auth/src",
        "apps/auth/package.json",
        "pnpm-lock.yaml",
        "deploy/hono/services/Dockerfile.mail",
        "packages/database",
        "packages/execution",
      ],
      env,
    );
    return { ...images, mail: activeMailImage(env) };
  } catch {
    /* A changed or absent relay needs a new image. */
  }
  const repository = `registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/quorem-hono-production-mail`;
  const tag = `${repository}:${env.GITHUB_SHA}`;
  runStageCommand(
    "docker",
    ["build", "-f", "deploy/hono/services/Dockerfile.mail", "-t", tag, "."],
    env,
  );
  runStageCommand("vp", ["-C", "apps/api", "exec", "wrangler", "containers", "push", tag], env);
  const digests = JSON.parse(
    runStageCommand("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", tag], env),
  );
  const match = digests.filter(
    (value) => value.startsWith(`${repository}@sha256:`) && /[a-f0-9]{64}$/.test(value),
  );
  if (match.length !== 1) throw new Error("Mail image digest missing");
  return { ...images, mail: match[0] };
}

/** A new case image must match the runtime inputs covered by a successful CI run. */
export async function validatedJudgeImages(env, validationRun, priorRelease) {
  if (!/^[1-9]\d{0,14}$/.test(validationRun)) throw new Error("Invalid judge validation run");
  const endpoint = `repos/ethan-ngai/quorem/actions/runs/${validationRun}`;
  const run = JSON.parse(runStageCommand("gh", ["api", endpoint], env));
  if (
    run.conclusion !== "success" ||
    run.path !== ".github/workflows/ci.yaml" ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? "")
  )
    throw new Error("Judge validation run did not pass CI");
  const { jobs } = JSON.parse(runStageCommand("gh", ["api", `${endpoint}/jobs`], env));
  const checks = jobs.find((job) => job.name === "checks" && job.conclusion === "success");
  if (
    ![
      "Mandatory composed runtime release validation",
      "Mandatory container runner release validation",
    ].every((name) =>
      checks?.steps?.some((step) => step.name === name && step.conclusion === "success"),
    )
  )
    throw new Error("Judge validation steps did not pass");
  runStageCommand("git", ["merge-base", "--is-ancestor", run.head_sha, env.GITHUB_SHA], env);
  runStageCommand(
    "git",
    [
      "diff",
      "--exit-code",
      run.head_sha,
      env.GITHUB_SHA,
      "--",
      "apps/runner",
      "packages/contracts",
      "packages/database",
      "packages/execution",
      "packages/questions",
      "internal/execution/public",
      "deploy/Dockerfile.case",
      "deploy/cgroup.py",
      "deploy/seccomp.py",
      "deploy/hono/Dockerfile.runner",
      "scripts/build-judge-images.py",
      "pnpm-lock.yaml",
    ],
    env,
  );
  const reused = await reusableNativeImages(env, priorRelease);
  const images =
    reused ??
    publishImages({
      ...env,
      HONO_DEPLOYMENT_SCOPE: "production",
      TF_VAR_profile_media_enabled: "false",
      HONO_MAIL_RELAY_ENABLED: "false",
    });
  console.log(
    JSON.stringify({
      phase: reused ? "reuse-verified-native-images" : "publish-verified-native-images",
    }),
  );
  const { image, mail } = activeTrustedImages(env);
  return { ...images, image, mail };
}

function activeMailImage(env) {
  return activeTrustedImages(env, ["mail"]).mail;
}

function activeTrustedImages(env, roles = ["image", "mail"]) {
  runStageCommand(
    "terraform",
    terraformBackendArgs(env, "hono-services", "hono-production-services"),
    env,
  );
  const state = JSON.parse(
    runStageCommand("terraform", ["-chdir=infra/terraform/hono-services", "state", "pull"], env),
  );
  const trusted = state.resources?.find(
    (item) => item.type === "restapi_object" && item.name === "trusted",
  );
  return Object.fromEntries(
    roles.map((role) => {
      const service = trusted?.instances?.find((item) => item.index_key === role);
      const value = service && JSON.parse(service.attributes.data).configuration.image;
      if (
        typeof value !== "string" ||
        !value.startsWith(`registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/`) ||
        !/@sha256:[a-f0-9]{64}$/.test(value)
      )
        throw new Error("Active trusted image missing");
      return [role, value];
    }),
  );
}
