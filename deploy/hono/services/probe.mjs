/** Verify the staged case namespace before granting runner scope. */
import { readFile } from "node:fs/promises";
import { createPublicKey, randomUUID } from "node:crypto";
import { verifyCaseProbe } from "../../case-proof.js";

export async function probeNamespace(env, send = fetch) {
  const origin = env.QUOREM_CASE_ORIGIN,
    bearer = env.QUOREM_CASE_SECRET;
  const file = env.QUOREM_CASE_OWNER_PUBLIC_KEY_FILE;
  if (!origin || !bearer || bearer.length < 32 || /\s/.test(bearer) || !file?.startsWith("/"))
    throw new Error("Invalid case probe configuration");
  const pem = await readFile(file);
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Invalid case probe key");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    key.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin)
    throw new Error("Invalid case probe origin");
  const nonce = randomUUID();
  const response = await send(new URL("/internal/case/namespace", origin), {
    headers: { authorization: `Bearer ${bearer}`, "x-quorem-owner-nonce": nonce },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  return verifyCaseProbe(response, {
    publicKey,
    kind: "namespace",
    scope: "",
    attempt: "namespace",
    nonce,
  });
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await probeNamespace(process.env)));
  } catch {
    console.error("Case namespace verification failed");
    process.exitCode = 1;
  }
}
