import { describe, expect, it } from "vitest";
import {
  verificationReceiptBytes,
  verifyResultReceipt,
  type VerificationReceipt,
} from "../src/index.ts";
const receipt: VerificationReceipt = {
  challenge: "challenge",
  jobId: "job",
  submissionId: "submission",
  attemptId: "attempt",
  sandboxScope: "scope",
  binding: "a".repeat(64),
  frameHash: "b".repeat(64),
  ordinal: 0,
  channel: "private",
  status: "wrong_answer",
  actualHash: "c".repeat(64),
  expectedHash: "d".repeat(64),
};
describe("verification receipt", () => {
  it("verifies Ed25519 and binds every trusted field", async () => {
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        keys.privateKey,
        new Uint8Array(verificationReceiptBytes(receipt)),
      ),
    );
    expect(await verifyResultReceipt(receipt, signature, keys.publicKey)).toBe(true);
    for (const altered of [
      { ...receipt, status: "accepted" },
      { ...receipt, ordinal: 1 },
      { ...receipt, frameHash: "e".repeat(64) },
      { ...receipt, challenge: "other" },
      { ...receipt, attemptId: "other" },
      { ...receipt, sandboxScope: "other" },
      { ...receipt, expectedHash: null },
    ])
      expect(await verifyResultReceipt(altered, signature, keys.publicKey)).toBe(false);
  });
});
