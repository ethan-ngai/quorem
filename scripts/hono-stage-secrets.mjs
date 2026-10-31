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
    apiAccess = env.CLOUDFLARE_ACCESS_CLIENT_SECRET,
    drainAccess = env.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET,
    verifierAccess = env.VERIFICATION_ACCESS_CLIENT_SECRET;
  if (
    ![source, service].every((v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v)) ||
    typeof drain !== "string" ||
    new TextEncoder().encode(drain).length < 32 ||
    /\s/.test(drain) ||
    ![
      env.CLOUDFLARE_ACCESS_CLIENT_ID,
      env.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
      env.VERIFICATION_ACCESS_CLIENT_ID,
      verifierAccess,
      apiAccess,
      drainAccess,
    ].every((value) => typeof value === "string" && value.length > 0 && !/\s/.test(value))
  )
    throw new Error("Invalid private credentials");
  const profileId = env.PROFILE_IMAGE_ACCESS_CLIENT_ID,
    profileSecret = env.PROFILE_IMAGE_ACCESS_CLIENT_SECRET,
    profileToken = env.PROFILE_IMAGE_SERVICE_TOKEN;
  if (
    (profileId === undefined) !== (profileSecret === undefined) ||
    (profileId !== undefined &&
      (!profileId ||
        !profileSecret ||
        /\s/.test(profileId + profileSecret) ||
        profileId === profileSecret))
  )
    throw new Error("Invalid profile credentials");
  const all = [
    source,
    service,
    drain,
    apiAccess,
    drainAccess,
    verifierAccess,
    ...peers.map((p) => p.secret),
    ...[profileSecret, profileToken].filter((v) => v !== undefined),
  ];
  if (new Set(all).size !== all.length) throw new Error("Private credentials must be distinct");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  checkSecrets(process.env);
