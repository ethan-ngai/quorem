/** Pin the signed namespace to the canonical remote sandbox scope. */
import { readFile } from "node:fs/promises";
import { probeNamespace } from "../deploy/hono/services/probe.mjs";
import { remoteSandbox } from "../apps/runner/src/sandbox/remote.ts";

export async function stageNamespace(env, pinned, probe = probeNamespace) {
  if (!/^[0-9a-f]{64}$/.test(pinned)) throw new Error("Invalid namespace pin");
  const result = await probe(env);
  const namespace = result?.namespace;
  if (!/^[0-9a-f]{64}$/.test(namespace ?? "") || namespace === "0".repeat(64))
    throw new Error("Invalid signed namespace");
  if (pinned !== "0".repeat(64) && pinned !== namespace)
    throw new Error("Existing namespace changed");
  const publicKey = await readFile(env.QUOREM_CASE_OWNER_PUBLIC_KEY_FILE, "utf8");
  const sandbox = remoteSandbox({
    origin: env.QUOREM_CASE_ORIGIN,
    secret: env.QUOREM_CASE_SECRET,
    namespaceId: namespace,
    ownerPublicKey: publicKey,
    cleanupMs: 30000,
  });
  return { namespace, scope: sandbox.scope };
}
