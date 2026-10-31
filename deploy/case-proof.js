/** Canonical stage-only case probe transcript and Ed25519 verification. */
const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
/** Validate the exact public projection before signing or accepting it. */
export function validRunnerControlState(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === "bindings,generation,release,status" &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0 &&
    ["paused", "prepared", "active"].includes(value.status) &&
    (value.generation === 0
      ? value.status === "paused" && value.release === null && value.bindings === null
      : typeof value.release === "string" &&
        /^[a-f0-9]{40}$/.test(value.release) &&
        typeof value.bindings === "string" &&
        /^[a-f0-9]{64}$/.test(value.bindings))
  );
}
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
 * @param {{publicKey: CryptoKey, kind: string, scope?: string, attempt: string, nonce: string, expectedNamespace?: string, expectedAfter?: string}} options
 */
export async function verifyCaseProbe(
  response,
  { publicKey, kind, scope = "", attempt, nonce, expectedNamespace, expectedAfter },
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
  if (
    (kind === "control-state" || kind === "control-inventory" || kind === "runner-control-state") &&
    (!/^[a-f0-9]{64}$/.test(expectedNamespace ?? "") ||
      !/^remote:[a-f0-9]{64}$/.test(scope) ||
      attempt !== (kind === "runner-control-state" ? "runner-control" : "control"))
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
        : kind === "runner-control-state"
          ? !validRunnerControlState(value)
          : kind === "control-state"
            ? Object.keys(value).sort().join() !==
                "activationOperation,bindings,generation,initialOperation,initialRelease,namespace,pauseOperation,paused,release,scope" ||
              value.namespace !== namespace ||
              value.scope !== scope ||
              typeof value.initialOperation !== "string" ||
              !/^[a-f0-9-]{36}$/.test(value.initialOperation) ||
              typeof value.initialRelease !== "string" ||
              !/^[a-f0-9]{40}$/.test(value.initialRelease) ||
              !Number.isSafeInteger(value.generation) ||
              value.generation < 0 ||
              (value.generation === 0
                ? value.release !== null ||
                  value.bindings !== null ||
                  value.activationOperation !== null ||
                  value.pauseOperation !== null ||
                  !value.paused
                : typeof value.release !== "string" ||
                  !/^[a-f0-9]{40}$/.test(value.release) ||
                  typeof value.bindings !== "string" ||
                  !/^[a-f0-9]{64}$/.test(value.bindings) ||
                  typeof value.activationOperation !== "string" ||
                  !/^[a-f0-9-]{36}$/.test(value.activationOperation) ||
                  (value.paused
                    ? typeof value.pauseOperation !== "string" ||
                      !/^[a-f0-9-]{36}$/.test(value.pauseOperation)
                    : value.pauseOperation !== null)) ||
              typeof value.paused !== "boolean" ||
              value.generation >= Number.MAX_SAFE_INTEGER
            : kind === "control-inventory"
              ? Object.keys(value).sort().join() !== "after,attempts,next" ||
                typeof expectedAfter !== "string" ||
                value.after !== expectedAfter ||
                (value.after !== "" && !/^[A-Za-z0-9-]{1,128}$/.test(value.after)) ||
                !Array.isArray(value.attempts) ||
                value.attempts.length > 4 ||
                value.attempts.some(
                  (item, index) =>
                    typeof item !== "string" ||
                    !/^[A-Za-z0-9-]{1,128}$/.test(item) ||
                    item <= (index ? value.attempts[index - 1] : value.after),
                ) ||
                (value.next !== null &&
                  (value.attempts.length === 0 || value.next !== value.attempts.at(-1)))
              : true)
  )
    throw new Error("Invalid case probe");
  return value;
}
