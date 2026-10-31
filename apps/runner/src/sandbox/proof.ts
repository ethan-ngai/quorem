/** @file proof.ts @description Local ownership of completed sandbox result receipts. @module runner */
import { createHash } from "node:crypto";
import type { CaseOutput, CaseRequest } from "./types.ts";
const receipts = new WeakMap<CaseOutput, string>();
function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function identity(request: CaseRequest, output: CaseOutput): string {
  return JSON.stringify([
    request.binding,
    request.fence.attemptId,
    request.fence.sandboxScope,
    request.ordinal,
    request.language,
    request.input.hash,
    request.input.size,
    digest(output.stdout),
    digest(output.stderr),
    output.exitCode,
    output.compilationMs ?? 0,
  ]);
}
/** Only the selected adapter issues a receipt after its own teardown succeeds. */
export function confirmCaseOutput(request: CaseRequest, output: CaseOutput): CaseOutput {
  const result = Object.freeze({ ...output });
  receipts.set(result, identity(request, result));
  return result;
}
export function assertCaseOutput(request: CaseRequest, output: CaseOutput): void {
  if (receipts.get(output) !== identity(request, output))
    throw new Error("Unconfirmed sandbox case");
}

const failures = new WeakMap<Error, string>();
/** Failure verdicts also require cleanup of the exact invocation. */
export function confirmCaseFailure(request: CaseRequest, error: Error): Error {
  failures.set(
    error,
    identity(request, { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0 }),
  );
  return error;
}
export function assertCaseFailure(request: CaseRequest, error: Error): void {
  if (
    failures.get(error) !==
    identity(request, { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0 })
  )
    throw new Error("Unconfirmed sandbox case failure");
}
