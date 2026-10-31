/** Canonical stage-only case probe transcript and Ed25519 verification. */
const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
export async function caseProbeBytes({ kind, scope, namespace, attempt, status, nonce, body }) {
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  return encoder.encode(
    JSON.stringify([
      "quorem-case-probe-v1",
      kind,
      "GET",
      scope,
      namespace,
      attempt,
      "",
      status,
      nonce,
      digest,
    ]),
  );
}
export async function signedCaseProbe(env, { kind, scope, attempt, nonce, value }) {
  const namespace = env.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
  if (!/^[a-f0-9]{64}$/.test(namespace) || !/^[a-f0-9-]{36}$/.test(nonce ?? ""))
    throw new Error("Invalid probe binding");
  const body = encoder.encode(JSON.stringify(value));
  const keyBytes = Uint8Array.from(atob(env.CASE_OWNER_PRIVATE_KEY), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "Ed25519" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      key,
      await caseProbeBytes({ kind, scope, namespace, attempt, status: 200, nonce, body }),
    ),
  );
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-quorem-owner-namespace": namespace,
      "x-quorem-owner-signature": btoa(String.fromCharCode(...signature)),
    },
  });
}
/**
 * Verify an authenticated bounded response against caller bindings.
 * @param {Response} response
 * @param {{publicKey: CryptoKey, kind: string, scope?: string, attempt: string, nonce: string, expectedNamespace?: string}} options
 */
export async function verifyCaseProbe(
  response,
  { publicKey, kind, scope = "", attempt, nonce, expectedNamespace },
) {
  const namespace = response.headers.get("x-quorem-owner-namespace"),
    raw = response.headers.get("x-quorem-owner-signature");
  if (
    response.status !== 200 ||
    !response.body ||
    !/^[a-f0-9]{64}$/.test(namespace ?? "") ||
    (expectedNamespace && namespace !== expectedNamespace) ||
    !/^[a-f0-9-]{36}$/.test(nonce ?? "") ||
    !/^[A-Za-z0-9+/]{86}==$/.test(raw ?? "")
  )
    throw new Error("Invalid case probe");
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        throw new Error("Invalid case probe");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  const signature = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify(
    "Ed25519",
    publicKey,
    signature,
    await caseProbeBytes({
      kind,
      scope,
      namespace,
      attempt,
      status: response.status,
      nonce,
      body,
    }),
  );
  if (!valid) throw new Error("Invalid case probe");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (kind === "namespace"
      ? Object.keys(value).join() !== "namespace" || value.namespace !== namespace
      : kind === "lifecycle"
        ? Object.keys(value).sort().join() !== "active,ordinal,running,tokenHash" ||
          typeof value.active !== "boolean" ||
          typeof value.running !== "boolean" ||
          (value.active
            ? !value.running ||
              !Number.isSafeInteger(value.ordinal) ||
              value.ordinal < -1 ||
              value.ordinal > 2147483646 ||
              !/^[a-f0-9]{64}$/.test(value.tokenHash)
            : value.ordinal !== null || value.tokenHash !== null)
        : true)
  )
    throw new Error("Invalid case probe");
  return value;
}
