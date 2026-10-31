import { signedCaseProbe } from "./case-proof.js";
export async function caseRequest(request, env, attempt, credential = env.JUDGE_CONTROL_TOKEN) {
  if (
    typeof credential !== "string" ||
    credential.length < 32 ||
    request.headers.get("Authorization") !== `Bearer ${credential}` ||
    (!(request.method === "GET" && (attempt === "ready" || env.CASE_DIAGNOSTICS === "true")) &&
      !["POST", "DELETE"].includes(request.method))
  )
    return new Response(null, { status: 404 });
  if (!env.CASES) return new Response(null, { status: 503 });
  if (request.method === "GET" && attempt === "ready") return new Response(null, { status: 204 });
  const nonce = request.headers.get("x-quorem-owner-nonce"),
    scope = request.headers.get("x-quorem-owner-scope");
  const bound = !!nonce || !!scope;
  if (
    bound &&
    (!/^[a-f0-9-]{36}$/.test(nonce ?? "") ||
      !/^remote:[a-f0-9]{64}$/.test(scope ?? "") ||
      typeof env.CASE_OWNER_PRIVATE_KEY !== "string" ||
      typeof env.CASES.idFromName !== "function")
  )
    return new Response(null, { status: 503 });
  let caseFields = ["", "", "", "", "", ""];
  let attestedBody;
  if (bound && request.method === "POST") {
    try {
      const binding = request.headers.get("x-quorem-case-binding") ?? "",
        declared = request.headers.get("x-quorem-body-sha256") ?? "",
        ordinal = request.headers.get("x-quorem-case-ordinal") ?? "";
      if (
        !/^[a-f0-9]{64}$/.test(binding) ||
        !/^[a-f0-9]{64}$/.test(declared) ||
        !/^(-1|0|[1-9][0-9]{0,9})$/.test(ordinal) ||
        Number(ordinal) > 2147483646
      )
        throw new Error("Invalid case binding");
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Missing case body");
      const parts = [];
      let length = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Case input too large");
        }
        parts.push(next.value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        body.set(part, offset);
        offset += part.length;
      }
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== declared) throw new Error("Case body mismatch");
      attestedBody = body;
      caseFields = [
        binding,
        digest,
        ordinal,
        request.headers.get("x-case-language") ?? "",
        request.headers.get("x-case-memory") ?? "",
        request.headers.get("x-case-processes") ?? "",
      ];
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  headers.delete("CF-Access-Client-Id");
  headers.delete("CF-Access-Client-Secret");
  const forwarded =
    attestedBody === undefined
      ? new Request(request, { headers })
      : new Request(request.url, {
          method: request.method,
          headers,
          body: attestedBody,
          signal: request.signal,
        });
  const response = await env.CASES.getByName(attempt, {
    locationHint: env.APP_LOCATION_HINT || "enam",
  }).fetch(forwarded);
  if (request.method === "GET" && request.headers.get("x-quorem-case-probe") === "lifecycle") {
    if (!bound || env.CASE_DIAGNOSTICS !== "true" || response.status !== 200) {
      await response.body?.cancel();
      return new Response(null, { status: 404 });
    }
    try {
      const raw = await response.text();
      if (raw.length > 1024) throw new Error("Invalid probe");
      const value = JSON.parse(raw);
      if (
        !value ||
        Object.keys(value).sort().join() !== "active,ordinal,running,tokenHash" ||
        typeof value.active !== "boolean" ||
        typeof value.running !== "boolean" ||
        (value.active
          ? !Number.isSafeInteger(value.ordinal) ||
            !/^[a-f0-9]{64}$/.test(value.tokenHash) ||
            !value.running
          : value.ordinal !== null || value.tokenHash !== null)
      )
        throw new Error("Invalid probe");
      return await signedCaseProbe(env, {
        kind: "lifecycle",
        scope,
        attempt,
        nonce,
        value,
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  if (!bound) return response;
  if (
    !(
      (request.method === "POST" && response.status === 200) ||
      (request.method === "DELETE" && response.status === 204)
    )
  )
    return response;
  try {
    const namespace = env.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
    if (!/^[a-f0-9]{64}$/.test(namespace)) throw new Error("Invalid namespace");
    const keyBytes = Uint8Array.from(atob(env.CASE_OWNER_PRIVATE_KEY), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "Ed25519" }, false, [
      "sign",
    ]);
    const token = request.headers.get("x-case-token") ?? "";
    const message = new TextEncoder().encode(
      JSON.stringify([
        scope,
        namespace,
        request.method,
        attempt,
        token,
        response.status,
        nonce,
        ...caseFields,
      ]),
    );
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, message));
    const resultHeaders = new Headers(response.headers);
    resultHeaders.set("x-quorem-owner-namespace", namespace);
    resultHeaders.set("x-quorem-owner-signature", btoa(String.fromCharCode(...signature)));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resultHeaders,
    });
  } catch {
    await response.body?.cancel();
    return new Response(null, { status: 503 });
  }
}
