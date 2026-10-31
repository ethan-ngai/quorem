import worker from "../../../../deploy/worker.js";
export default {
  async fetch() {
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    const secret = btoa(String.fromCharCode(...privateBytes)),
      namespace = "a".repeat(64),
      scope = `remote:${"b".repeat(64)}`,
      nonce = "12345678-1234-1234-1234-123456789abc",
      token = "fixture-case-token-12345";
    const env = {
      APP_ORIGIN: "https://fixture.invalid",
      JUDGE_CONTROL_TOKEN: "fixture-only-control-token-1234567890",
      CASE_OWNER_PRIVATE_KEY: secret,
      CASES: {
        idFromName: () => ({ toString: () => namespace }),
        getByName: () => ({
          fetch: async (request) =>
            request.method === "DELETE"
              ? new Response(null, { status: 204 })
              : new Response("fixture", { status: 200 }),
        }),
      },
    };
    const response = await worker.fetch(
      new Request("https://fixture.invalid/internal/case/fixture", {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${env.JUDGE_CONTROL_TOKEN}`,
          "x-case-token": token,
          "x-quorem-owner-nonce": nonce,
          "x-quorem-owner-scope": scope,
        },
      }),
      env,
    );
    const signature = Uint8Array.from(
      atob(response.headers.get("x-quorem-owner-signature") ?? ""),
      (c) => c.charCodeAt(0),
    );
    const message = new TextEncoder().encode(
      JSON.stringify([
        scope,
        namespace,
        "DELETE",
        "fixture",
        token,
        204,
        nonce,
        "",
        "",
        "",
        "",
        "",
        "",
      ]),
    );
    const valid = await crypto.subtle.verify("Ed25519", keys.publicKey, signature, message);
    const input = new Uint8Array([1, 2, 3]),
      binding = "f".repeat(64),
      ordinal = "0",
      language = "python",
      memory = "268435456",
      processes = "16";
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    const headers = {
      authorization: `Bearer ${env.JUDGE_CONTROL_TOKEN}`,
      "x-case-token": token,
      "x-quorem-owner-nonce": nonce,
      "x-quorem-owner-scope": scope,
      "x-quorem-case-binding": binding,
      "x-quorem-body-sha256": digest,
      "x-quorem-case-ordinal": ordinal,
      "x-case-language": language,
      "x-case-memory": memory,
      "x-case-processes": processes,
    };
    const posted = await worker.fetch(
      new Request("https://fixture.invalid/internal/case/fixture", {
        method: "POST",
        headers,
        body: input,
      }),
      env,
    );
    const postSignature = Uint8Array.from(
      atob(posted.headers.get("x-quorem-owner-signature") ?? ""),
      (c) => c.charCodeAt(0),
    );
    const postMessage = new TextEncoder().encode(
      JSON.stringify([
        scope,
        namespace,
        "POST",
        "fixture",
        token,
        200,
        nonce,
        binding,
        digest,
        ordinal,
        language,
        memory,
        processes,
      ]),
    );
    const postValid = await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      postSignature,
      postMessage,
    );
    const tampered = await worker.fetch(
      new Request("https://fixture.invalid/internal/case/fixture", {
        method: "POST",
        headers,
        body: new Uint8Array([4]),
      }),
      env,
    );
    return Response.json({
      status: response.status,
      namespace: response.headers.get("x-quorem-owner-namespace"),
      valid,
      postValid,
      tampered: tampered.status,
    });
  },
};
