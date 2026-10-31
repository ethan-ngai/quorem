/** @file config.ts @description Strict runtime capability configuration. @module runtime */
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
  return {
    runnerPeers,
    verificationSourceCredential: required(env.VERIFICATION_SOURCE_CREDENTIAL),
    verificationServiceCredential: required(env.VERIFICATION_SERVICE_CREDENTIAL),
    verificationServiceOrigin: required(env.VERIFICATION_SERVICE_ORIGIN),
    verificationPublicKey: required(env.VERIFICATION_PUBLIC_KEY),
  };
}
