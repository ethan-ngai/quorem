/** Validate private credential separation without printing or persisting values. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function checkSecrets(env) {
  let peers;
  try {
    peers = JSON.parse(env.RUNNER_PEERS);
  } catch {
    throw new Error("Invalid runner peer configuration");
  }
  if (
    !Array.isArray(peers) ||
    !peers.length ||
    peers.length > 32 ||
    peers.some(
      (p) =>
        !p ||
        typeof p.secret !== "string" ||
        new TextEncoder().encode(p.secret).length < 32 ||
        typeof p.scope !== "string" ||
        !p.scope ||
        typeof p.resumable !== "boolean",
    )
  )
    throw new Error("Invalid runner peer configuration");
  const source = env.VERIFICATION_SOURCE_CREDENTIAL,
    service = env.VERIFICATION_SERVICE_CREDENTIAL,
    drain = env.EXECUTION_DRAIN_SECRET,
    profileToken = env.PROFILE_IMAGE_SERVICE_TOKEN;
  if (
    ![source, service].every((v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v)) ||
    typeof drain !== "string" ||
    new TextEncoder().encode(drain).length < 32 ||
    /\s/.test(drain) ||
    (profileToken !== undefined &&
      (typeof profileToken !== "string" ||
        new TextEncoder().encode(profileToken).length < 32 ||
        /\s/.test(profileToken)))
  )
    throw new Error("Invalid private credentials");
  const all = [
    source,
    service,
    drain,
    ...peers.map((p) => p.secret),
    ...[profileToken].filter((v) => v !== undefined),
  ];
  if (new Set(all).size !== all.length) throw new Error("Private credentials must be distinct");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  checkSecrets(process.env);
