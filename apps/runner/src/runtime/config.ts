/** @file config.ts @description Fail-closed trusted runner process configuration. @module runner */
import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";

type Env = NodeJS.ProcessEnv;
function required(env: Env, name: string): string {
  const value = env[name];
  if (!value || value.trim() !== value) throw new Error(`Missing or invalid ${name}`);
  return value;
}
function integer(env: Env, name: string, fallback: number, max: number): number {
  const raw = env[name] ?? String(fallback);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max)
    throw new Error(`Invalid ${name}`);
  return Number(raw);
}
function secret(env: Env, name: string): string {
  const value = required(env, name);
  if (new TextEncoder().encode(value).length < 32 || /\s/.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
}
function key(env: Env, name: string): Uint8Array {
  const value = required(env, name);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid ${name}`);
  return Buffer.from(value, "hex");
}
function origin(env: Env, name: string): string {
  let url: URL;
  try {
    url = new URL(required(env, name));
  } catch {
    throw new Error(`Invalid ${name}`);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error(`Invalid ${name}`);
  return url.origin;
}
function access(
  env: Env,
  target: string,
  idName = "CLOUDFLARE_ACCESS_CLIENT_ID",
  secretName = "CLOUDFLARE_ACCESS_CLIENT_SECRET",
) {
  const id = env[idName],
    secret = env[secretName];
  if (id === undefined && secret === undefined) return undefined;
  if (
    !id ||
    !secret ||
    id === secret ||
    /\s/.test(id) ||
    /\s/.test(secret) ||
    id.length > 256 ||
    secret.length > 256 ||
    new URL(target).protocol !== "https:"
  )
    throw new Error("Invalid private ingress configuration");
  return { id, secret };
}
function listen(env: Env, name: string): { host: string; port: number } {
  const value = required(env, name);
  const match = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|\[::\]):([1-9]\d{0,4})$/.exec(value);
  if (!match || Number(match[2]) > 65535) throw new Error(`Invalid ${name}`);
  return { host: match[1].replace(/^\[|\]$/g, ""), port: Number(match[2]) };
}
export function runnerConfig(env: Env) {
  const commandSecret = secret(env, "QUOREM_RUNNER_COMMAND_SECRET"),
    drainSecret = secret(env, "QUOREM_RUNNER_DRAIN_SECRET");
  if (commandSecret === drainSecret) throw new Error("Distinct runner credentials required");
  const mode = required(env, "QUOREM_RUNNER_MODE");
  if (mode !== "http" && mode !== "continuous") throw new Error("Invalid runner mode");
  const commandOrigin = origin(env, "QUOREM_RUNNER_COMMAND_ORIGIN");
  const ingress = access(env, commandOrigin);
  if (ingress && [commandSecret, drainSecret].includes(ingress.secret))
    throw new Error("Distinct credentials required");
  const provider = required(env, "QUOREM_SANDBOX_PROVIDER");
  let sandbox:
    | { provider: "docker"; socket: string; stateRoot: string; namespace: string }
    | {
        provider: "remote";
        origin: string;
        secret: string;
        namespaceId: string;
        publicKeyFile: string;
        access?: { id: string; secret: string };
      };
  if (provider === "docker") {
    const socket = required(env, "QUOREM_DOCKER_SOCKET"),
      stateRoot = required(env, "QUOREM_DOCKER_FENCE_ROOT"),
      namespace = required(env, "QUOREM_DOCKER_NAMESPACE");
    if (
      !socket.startsWith("/") ||
      !stateRoot.startsWith("/") ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(namespace)
    )
      throw new Error("Invalid Docker configuration");
    sandbox = { provider, socket, stateRoot, namespace };
  } else if (provider === "remote") {
    const caseOrigin = origin(env, "QUOREM_CASE_ORIGIN"),
      caseSecret = secret(env, "QUOREM_CASE_SECRET"),
      namespaceId = required(env, "QUOREM_CASE_NAMESPACE_ID"),
      publicKeyFile = required(env, "QUOREM_CASE_OWNER_PUBLIC_KEY_FILE");
    const caseAccess = access(
      env,
      caseOrigin,
      "QUOREM_CASE_ACCESS_CLIENT_ID",
      "QUOREM_CASE_ACCESS_CLIENT_SECRET",
    );
    if (
      !/^[a-f0-9]{64}$/.test(namespaceId) ||
      !publicKeyFile.startsWith("/") ||
      [commandSecret, drainSecret, ingress?.id, ingress?.secret].includes(caseSecret)
    )
      throw new Error("Invalid remote sandbox configuration");
    if (
      caseAccess &&
      [caseSecret, commandSecret, drainSecret, ingress?.id, ingress?.secret].some(
        (value) => value === caseAccess.id || value === caseAccess.secret,
      )
    )
      throw new Error("Distinct credentials required");
    sandbox = {
      provider,
      origin: caseOrigin,
      secret: caseSecret,
      namespaceId,
      publicKeyFile,
      access: caseAccess,
    };
  } else throw new Error("Invalid sandbox provider");
  return {
    mode,
    sandbox,
    commandSecret,
    drainSecret,
    commandOrigin,
    access: ingress,
    listen: listen(env, "QUOREM_RUNNER_LISTEN"),
    slots: integer(env, "QUOREM_RUNNER_SLOTS", 1, 8),
    commandTimeoutMs: integer(env, "QUOREM_RUNNER_COMMAND_TIMEOUT_MS", 5000, 60000),
    cleanupMs: integer(env, "QUOREM_SANDBOX_CLEANUP_MS", 30000, 120000),
    pollMs: integer(env, "QUOREM_RUNNER_RECOVERY_POLL_MS", 1000, 60000),
  } as const;
}
export async function verifierConfig(env: Env) {
  const sourceCredential = key(env, "QUOREM_VERIFICATION_SOURCE_KEY"),
    serviceCredential = key(env, "QUOREM_VERIFICATION_SERVICE_KEY");
  if (Buffer.from(sourceCredential).equals(Buffer.from(serviceCredential)))
    throw new Error("Distinct verification credentials required");
  const file = required(env, "QUOREM_VERIFICATION_SIGNING_KEY_FILE");
  if (!file.startsWith("/")) throw new Error("Invalid verification key file");
  let signingKey: CryptoKey;
  try {
    const privateKey = createPrivateKey(await readFile(file));
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("key");
    signingKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKey.export({ type: "pkcs8", format: "der" }),
      "Ed25519",
      false,
      ["sign"],
    );
  } catch {
    throw new Error("Invalid verification signing key");
  }
  const sourceOrigin = origin(env, "QUOREM_VERIFICATION_SOURCE_ORIGIN");
  const ingress = access(env, sourceOrigin);
  if (
    ingress &&
    [
      Buffer.from(sourceCredential).toString("hex"),
      Buffer.from(serviceCredential).toString("hex"),
    ].includes(ingress.secret)
  )
    throw new Error("Distinct credentials required");
  return {
    sourceOrigin,
    access: ingress,
    sourceCredential,
    serviceCredential,
    signingKey,
    listen: listen(env, "QUOREM_VERIFIER_LISTEN"),
    timeoutMs: integer(env, "QUOREM_VERIFICATION_TIMEOUT_MS", 30000, 120000),
  };
}
