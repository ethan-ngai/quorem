/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import verifierWorker from "../runtime/worker-verifier.ts";
import type { VerificationReceipt } from "@quorem/execution";
import { verificationFetch } from "./http.ts";

const credential = new Uint8Array(32).fill(1);
const request = () =>
  new Request("https://verifier/internal/results/verify", {
    method: "POST",
    headers: { authorization: `Bearer ${Buffer.from(credential).toString("hex")}` },
    body: JSON.stringify({ challenge: "challenge" }),
  });

void test(
  "verification flushes headers before proof is available, then returns complete JSON",
  { timeout: 2000 },
  async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = verificationFetch({
      credential,
      timeoutMs: 1000,
      async verify() {
        await pending;
        return { receipt: {} as VerificationReceipt, signature: new Uint8Array(64) };
      },
    });
    const response = await handler(request());
    const reader = response.body!.getReader();
    try {
      assert.equal(response.status, 200);
      assert.equal(new TextDecoder().decode((await reader.read()).value), " ");
    } finally {
      release();
    }
    const result = await reader.read();
    assert.equal(
      JSON.parse(new TextDecoder().decode(result.value)).signature,
      Buffer.alloc(64).toString("base64"),
    );
    assert.equal((await reader.read()).done, true);
  },
);

void test("post-admission proof failures abort the body without a result", async () => {
  const handler = verificationFetch({
    credential,
    timeoutMs: 1000,
    async verify() {
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error("proof unavailable");
    },
  });
  const response = await handler(request());
  await assert.rejects(response.json(), /proof unavailable/);
});

void test("response cancellation aborts independent verification", async () => {
  let signal!: AbortSignal;
  const cancelled = verificationFetch({
    credential,
    timeoutMs: 1000,
    async verify(_challenge, active) {
      signal = active;
      await new Promise((_resolve, reject) =>
        active.addEventListener("abort", () => reject(active.reason), { once: true }),
      );
      throw new Error("cancelled");
    },
  });
  const response = await cancelled(request());
  await response.body!.cancel();
  assert.equal(signal.aborted, true);
});

void test("verifier Worker binds proof reads to the source service and retains credential checks", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const env: NodeJS.ProcessEnv = {
    VERIFIER_ORIGIN: "https://verifier",
    QUOREM_VERIFICATION_SOURCE_ORIGIN: "https://source",
    QUOREM_VERIFICATION_SOURCE_KEY: "11".repeat(32),
    QUOREM_VERIFICATION_SERVICE_KEY: Buffer.from(credential).toString("hex"),
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
  let reads = 0;
  const bound = Object.assign(env, {
    VERIFICATION_SOURCE: {
      async fetch(req: Request) {
        reads++;
        assert.equal(req.url, "https://source/internal/verification/bundle");
        assert.equal(req.headers.get("authorization"), `Bearer ${"11".repeat(32)}`);
        assert.equal(req.redirect, "manual");
        assert.deepEqual(await req.json(), { challenge: "challenge" });
        return new Response(null, { status: 503 });
      },
    },
  });
  const bad = request();
  bad.headers.set("authorization", "Bearer invalid");
  assert.equal((await verifierWorker.fetch(bad, bound)).status, 401);
  assert.equal(reads, 0);
  assert.equal((await verifierWorker.fetch(new Request("https://other/"), bound)).status, 404);
  const response = await verifierWorker.fetch(request(), bound);
  assert.equal(response.status, 200);
  await assert.rejects(response.json(), /Verification source unavailable/);
  assert.equal(reads, 1);
});
