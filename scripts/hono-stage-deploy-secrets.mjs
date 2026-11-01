/** Upload only canonical Worker secrets over stdin; never persist provider output. */
import { spawnSync } from "node:child_process";
import { validatedWorkerSecrets } from "./hono-stage-preflight.mjs";

export function uploadWorkerSecrets(input, outputs, secrets, env, run = spawnSync) {
  const name = outputs?.worker_name?.value;
  if (!/^[a-z][a-z0-9-]*-hono-stage$/.test(name ?? "")) throw new Error("Invalid staged Worker");
  const values = validatedWorkerSecrets(input, outputs, secrets);
  return putWorkerSecrets(name, values, env, run);
}

/** One provider owner; callers validate the selected runtime's credential contract. */
export function putWorkerSecrets(name, values, env, run = spawnSync) {
  if (
    !/^[a-z][a-z0-9-]{1,62}$/.test(name) ||
    !values ||
    Object.values(values).some((value) => typeof value !== "string" || !value)
  )
    throw new Error("Invalid Worker secret upload");
  const childEnv = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "TMPDIR",
      "CI",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "NODE_EXTRA_CA_CERTS",
    ]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
  const result = run(
    "vp",
    ["-C", "apps/api", "exec", "wrangler", "secret", "bulk", "--name", name],
    {
      env: childEnv,
      input: JSON.stringify(values),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("Worker secret upload failed; output withheld");
}
