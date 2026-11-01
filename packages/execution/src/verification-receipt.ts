/** @file verification-receipt.ts @description Signed, attempt-bound independent case verification. @module execution */
export interface VerificationReceipt {
  readonly challenge: string;
  readonly jobId: string;
  readonly submissionId: string;
  readonly attemptId: string;
  readonly sandboxScope: string;
  readonly binding: string;
  readonly frameHash: string;
  readonly ordinal: number;
  readonly channel: "public" | "sample" | "private";
  readonly status: string;
  readonly typeMismatch: boolean;
  readonly actualHash: string | null;
  readonly expectedHash: string | null;
}
const hex = /^[0-9a-f]{64}$/;
const statuses = new Set([
  "accepted",
  "wrong_answer",
  "executed",
  "syntax_error",
  "runtime_error",
  "time_limit",
  "memory_limit",
  "output_limit",
  "invalid_output",
]);
/** Fixed field order and domain separation prevent alternate encodings of the signed claim. */
export function verificationReceiptBytes(value: VerificationReceipt): Uint8Array {
  if (
    !/^[a-zA-Z0-9-]{1,128}$/.test(value.challenge) ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(value.jobId) ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(value.submissionId) ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(value.attemptId) ||
    !value.sandboxScope ||
    new TextEncoder().encode(value.sandboxScope).length > 256 ||
    !hex.test(value.binding) ||
    !hex.test(value.frameHash) ||
    !Number.isInteger(value.ordinal) ||
    value.ordinal < 0 ||
    value.ordinal > 2147483646 ||
    !["public", "sample", "private"].includes(value.channel) ||
    !statuses.has(value.status) ||
    typeof value.typeMismatch !== "boolean" ||
    (value.actualHash !== null && !hex.test(value.actualHash)) ||
    (value.expectedHash !== null && !hex.test(value.expectedHash))
  )
    throw new Error("Invalid verification receipt");
  return new TextEncoder().encode(
    JSON.stringify([
      "quorem-verification-receipt-v1",
      value.challenge,
      value.jobId,
      value.submissionId,
      value.attemptId,
      value.sandboxScope,
      value.binding,
      value.frameHash,
      value.ordinal,
      value.channel,
      value.status,
      value.typeMismatch,
      value.actualHash,
      value.expectedHash,
    ]),
  );
}
/** Verify before rechecking the live database fence and the frozen input identities. */
export async function verifyResultReceipt(
  value: VerificationReceipt,
  signature: Uint8Array,
  publicKey: CryptoKey,
): Promise<boolean> {
  if (
    signature.length !== 64 ||
    publicKey.algorithm.name !== "Ed25519" ||
    publicKey.type !== "public"
  )
    return false;
  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    new Uint8Array(signature),
    new Uint8Array(verificationReceiptBytes(value)),
  );
}
