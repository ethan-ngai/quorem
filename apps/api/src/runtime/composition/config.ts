/** @file config.ts @description Strict runtime capability configuration. @module runtime */
import { accessFetch } from "@quorem/execution/transport/access";
import { validateDrainTransport } from "./wake-consumer.ts";
import type { PrivateConfig } from "./private.ts";
export function required(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value)
    throw new Error("Missing runtime configuration");
  return value;
}
export function flag(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid runtime flag");
}
export function boundedInt(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
    throw new Error("Invalid runtime limit");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) throw new Error("Invalid runtime limit");
  return result;
}
export function keyBytes(value: unknown): Uint8Array {
  const text = required(value);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error("Invalid runtime key");
  return Uint8Array.from(text.match(/../g)!, (part) => parseInt(part, 16));
}
export function privateConfig(env: Record<string, unknown>): PrivateConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(env.RUNNER_PEERS));
  } catch {
    throw new Error("Invalid runner peers");
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 32)
    throw new Error("Invalid runner peers");
  const runnerPeers = parsed.map((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !["secret", "scope", "resumable"].includes(key))
    )
      throw new Error("Invalid runner peers");
    const peer = value as Record<string, unknown>;
    if (typeof peer.resumable !== "boolean") throw new Error("Invalid runner peers");
    return {
      secret: required(peer.secret),
      scope: required(peer.scope),
      resumable: peer.resumable,
    };
  });
  const verificationServiceOrigin = required(env.VERIFICATION_SERVICE_ORIGIN);
  let origin: URL;
  try {
    origin = new URL(verificationServiceOrigin);
  } catch {
    throw new Error("Invalid verifier origin");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        env.APP_ENV === "local" &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid verifier origin");
  const mode = required(env.VERIFICATION_ACCESS_MODE),
    id = env.VERIFICATION_ACCESS_CLIENT_ID,
    secret = env.VERIFICATION_ACCESS_CLIENT_SECRET;
  let verificationAccess: { id: string; secret: string } | undefined;
  if (mode === "none") {
    if (id !== undefined || secret !== undefined)
      throw new Error("Unexpected verifier Access credentials");
  } else if (mode === "cloudflare-access") {
    const pair = { id: required(id), secret: required(secret) };
    if (
      origin.protocol !== "https:" ||
      pair.id === pair.secret ||
      [pair.id, pair.secret].some((v) => /\s/.test(v) || v.length > 256) ||
      [
        env.VERIFICATION_SOURCE_CREDENTIAL,
        env.VERIFICATION_SERVICE_CREDENTIAL,
        env.EXECUTION_DRAIN_SECRET,
        env.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET,
        ...runnerPeers.map((p) => p.secret),
      ].includes(pair.secret)
    )
      throw new Error("Invalid verifier Access credentials");
    verificationAccess = pair;
  } else throw new Error("Invalid verifier Access mode");
  return {
    runnerPeers,
    verificationSourceCredential: required(env.VERIFICATION_SOURCE_CREDENTIAL),
    verificationServiceCredential: required(env.VERIFICATION_SERVICE_CREDENTIAL),
    verificationServiceOrigin,
    verificationPublicKey: required(env.VERIFICATION_PUBLIC_KEY),
    verificationAccess,
  };
}

/** Purpose-scoped drain transport shared by Node and Worker queue consumers. */
export function drainConfig(env: Record<string, unknown>) {
  const config = privateConfig(env),
    credential = required(env.EXECUTION_DRAIN_SECRET);
  const reserved = [
    config.verificationSourceCredential,
    config.verificationServiceCredential,
    ...config.runnerPeers.map((peer) => peer.secret),
  ];
  if (reserved.includes(credential)) throw new Error("Distinct drain credential required");
  const drainURL = required(env.EXECUTION_DRAIN_URL),
    mode = required(env.EXECUTION_DRAIN_ACCESS_MODE);
  const local = env.APP_ENV === "local";
  const url = validateDrainTransport(drainURL, credential, local);
  const id = env.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
    secret = env.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET;
  let send: typeof fetch | undefined;
  if (mode === "none") {
    if (id !== undefined || secret !== undefined)
      throw new Error("Unexpected drain Access credentials");
  } else if (mode === "cloudflare-access") {
    const pair = { id: required(id), secret: required(secret) };
    if (
      url.protocol !== "https:" ||
      pair.id === pair.secret ||
      [pair.id, pair.secret].some((value) => /\s/.test(value) || value.length > 256) ||
      [credential, ...reserved].includes(pair.secret)
    )
      throw new Error("Invalid drain Access credentials");
    send = accessFetch(url.origin, pair);
  } else throw new Error("Invalid drain Access mode");
  return { drainURL, credential, local, fetch: send };
}
