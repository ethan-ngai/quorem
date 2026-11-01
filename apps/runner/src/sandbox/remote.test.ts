import { bytesInput } from "./input.ts";
/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { defaultLimits } from "@quorem/execution";
import { remoteSandbox } from "./remote.ts";
const secret = "fixture-only-case-service-token-123456";
function frame(channel: number, value: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + value.length);
  result[0] = channel;
  new DataView(result.buffer).setUint32(4, value.length);
  result.set(value, 8);
  return result;
}
function setup(
  mode: "success" | "truncated" | "no-attestation" | "wrong-owner" | "wrong-namespace",
) {
  const key = generateKeyPairSync("ed25519"),
    wrong = generateKeyPairSync("ed25519");
  let deletions = 0;
  let scope = "";
  const fetcher: typeof fetch = async (input, init) => {
    const method = String(init?.method),
      headers = new Headers(init?.headers),
      attempt = new URL(input instanceof Request ? input.url : input.toString()).pathname
        .split("/")
        .pop()!,
      token = headers.get("x-case-token") ?? "",
      nonce = headers.get("x-quorem-owner-nonce") ?? "";
    const status = method === "DELETE" ? 204 : 200;
    if (method === "DELETE") deletions++;
    const namespaceId = (mode === "wrong-namespace" ? "b" : "a").repeat(64);
    const fields =
      method === "POST"
        ? [
            "x-quorem-case-binding",
            "x-quorem-body-sha256",
            "x-quorem-case-ordinal",
            "x-case-language",
            "x-case-memory",
            "x-case-processes",
          ].map((key) => headers.get(key) ?? "")
        : ["", "", "", "", "", ""];
    const signature = sign(
      null,
      Buffer.from(
        JSON.stringify([scope, namespaceId, method, attempt, token, status, nonce, ...fields]),
      ),
      mode === "wrong-owner" ? wrong.privateKey : key.privateKey,
    ).toString("base64");
    const h = new Headers(
      mode === "no-attestation"
        ? undefined
        : { "x-quorem-owner-signature": signature, "x-quorem-owner-namespace": namespaceId },
    );
    if (method === "DELETE") return new Response(null, { status, headers: h });
    const chunks = [
      frame(1, new Uint8Array([0, 65])),
      frame(3, new Uint8Array([0, 0, 0, 0])),
      ...(mode === "truncated" ? [] : [frame(4, new Uint8Array())]),
    ];
    return new Response(
      new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      }),
      { status, headers: h },
    );
  };
  const sandbox = remoteSandbox({
    origin: "https://cases.invalid",
    secret,
    namespaceId: "a".repeat(64),
    ownerPublicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    cleanupMs: 500,
    fetch: fetcher,
  });
  scope = sandbox.scope;
  const fence = { attemptId: "attempt-1", sandboxScope: scope };
  const request = {
    fence,
    binding: "a".repeat(64),
    ordinal: 0,
    language: "python",
    limits: defaultLimits(),
    input: bytesInput(new Uint8Array([1])),
    outputLimit: 65536,
    timeoutMs: 500,
  };
  return { sandbox, fence, request, deletions: () => deletions };
}
void test("signed owner and terminal frame authorize scoped success", async () => {
  const f = setup("success");
  assert.deepEqual([...(await f.sandbox.runCase(f.request)).stdout], [0, 65]);
  assert.equal(f.deletions(), 0);
  await assert.rejects(
    f.sandbox.teardownAttempt({ ...f.fence, sandboxScope: "wrong" }),
    /unconfirmed/,
  );
  await f.sandbox.teardownAttempt(f.fence);
  assert.equal(f.deletions(), 1);
});
void test("truncation requires signed cleanup before returning failure", async () => {
  const f = setup("truncated");
  await assert.rejects(f.sandbox.runCase(f.request));
  assert.equal(f.deletions(), 1);
});
void test("missing attestation and switched owner never confirm teardown", async () => {
  for (const mode of ["no-attestation", "wrong-owner", "wrong-namespace"] as const) {
    const f = setup(mode);
    await assert.rejects(f.sandbox.runCase(f.request), /unconfirmed/);
    await assert.rejects(f.sandbox.teardownAttempt(f.fence), /unconfirmed/);
  }
});
void test("ambiguous 404 is never teardown proof", async () => {
  const key = generateKeyPairSync("ed25519");
  const sandbox = remoteSandbox({
    origin: "https://cases.invalid",
    secret,
    namespaceId: "a".repeat(64),
    ownerPublicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    cleanupMs: 500,
    fetch: async () => new Response(null, { status: 404 }),
  });
  await assert.rejects(
    sandbox.teardownAttempt({ attemptId: "attempt", sandboxScope: sandbox.scope }),
    (error: unknown) =>
      error instanceof Error &&
      "diagnostic" in error &&
      JSON.stringify(error.diagnostic) ===
        JSON.stringify({ httpStatus: 404, signatureValid: false }),
  );
});
