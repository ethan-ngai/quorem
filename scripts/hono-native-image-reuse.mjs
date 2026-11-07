/** Reuse active native artifacts only when every Docker input is unchanged. */
import { runStageCommand } from "./hono-stage-command.mjs";

export const nativeImageInputs = [
  ".dockerignore",
  ".gitattributes",
  "apps/runner/Dockerfile",
  "apps/runner/Dockerfile.java",
  "apps/runner/Dockerfile.typescript",
  "apps/runner/Dockerfile.ocaml",
  "apps/runner/Dockerfile.postgres",
  "apps/runner/python",
  "apps/runner/polyglot",
  "apps/runner/postgres",
  "apps/runner/direct",
  "internal/execution/public",
  "deploy/Dockerfile.case",
  "deploy/cgroup.py",
  "deploy/seccomp.py",
  "scripts/build-judge-images.py",
  "scripts/hono-stage-deploy-images.mjs",
];
const roles = ["java", "ocaml", "postgresql", "python", "typescript"];

export async function reusableNativeImages(env, priorRelease, send = fetch, run = runStageCommand) {
  if (
    !/^[a-f0-9]{40}$/.test(priorRelease ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "")
  )
    throw new Error("Invalid native image provenance");
  try {
    // A rewritten release history requires a fresh build from validated inputs.
    run("git", ["merge-base", "--is-ancestor", priorRelease, env.GITHUB_SHA], env);
    run(
      "git",
      ["diff", "--exit-code", priorRelease, env.GITHUB_SHA, "--", ...nativeImageInputs],
      env,
    );
  } catch {
    return undefined;
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/quorem-hono-services-production`;
  const read = async (suffix) => {
    const response = await send(base + suffix, {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Native image metadata unavailable");
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder("utf-8", { fatal: true });
    let raw = "",
      size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1048576) {
          await reader.cancel();
          throw new Error("Native image metadata exceeded its bound");
        }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("Native image metadata was invalid");
    }
    if (payload?.success !== true || !payload.result)
      throw new Error("Native image metadata rejected");
    return payload.result;
  };
  const deployment = (await read("/deployments")).deployments?.[0];
  const versions = deployment?.versions;
  if (
    !Array.isArray(versions) ||
    versions.length !== 1 ||
    versions[0].percentage !== 100 ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(versions[0].version_id ?? "")
  )
    throw new Error("Native image deployment is not uniform");
  const version = await read(`/versions/${versions[0].version_id}`);
  const bindings = version.resources?.bindings;
  const inventory = version.resources?.script_runtime?.containers;
  const release = Array.isArray(bindings)
    ? bindings.find((binding) => binding.name === "SERVICES_RELEASE")
    : undefined;
  const containers = Array.isArray(inventory)
    ? inventory.filter((container) => container.class_name === "CaseSandbox")
    : [];
  const images = containers?.length === 1 ? containers[0].images : undefined;
  if (
    release?.type !== "plain_text" ||
    release.text !== priorRelease ||
    !images ||
    Object.keys(images).sort().join() !== roles.join() ||
    roles.some(
      (role) =>
        typeof images[role] !== "string" ||
        !images[role].startsWith(`registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/`) ||
        !/@sha256:[a-f0-9]{64}$/.test(images[role]),
    )
  )
    throw new Error("Active native image provenance mismatch");
  return images;
}
