import assert from "node:assert/strict";
import { test } from "node:test";
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
