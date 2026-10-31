/** @file types.ts @description Isolated case execution boundary. @module runner */
import type { CaseInput } from "./input.ts";
import type { AttemptFence, Job } from "@quorem/execution";
export interface CaseRequest {
  readonly fence: AttemptFence;
  readonly binding: string;
  readonly ordinal: number;
  readonly language: string;
  readonly limits: Job["limits"];
  readonly input: CaseInput;
  readonly outputLimit: number;
  readonly timeoutMs: number;
  readonly compileMs?: number;
}
export interface CaseOutput {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly exitCode: number;
  readonly compilationMs?: number;
}
export interface IsolatedSandbox {
  runCase(request: CaseRequest, signal?: AbortSignal): Promise<CaseOutput>;
  teardownAttempt(fence: AttemptFence, signal?: AbortSignal): Promise<void>;
}
export class UnconfirmedTeardown extends Error {
  constructor() {
    super("Sandbox teardown unconfirmed");
  }
}
export function validateCaseRequest(request: CaseRequest, scope: string): void {
  if (
    request.fence.sandboxScope !== scope ||
    !/^[a-f0-9]{64}$/.test(request.binding) ||
    !/^[A-Za-z0-9-]{1,128}$/.test(request.fence.attemptId) ||
    !Number.isInteger(request.ordinal) ||
    request.ordinal < -1 ||
    request.ordinal >= 320 ||
    !Number.isSafeInteger(request.input.size) ||
    request.input.size < 0 ||
    !/^[a-f0-9]{64}$/.test(request.input.hash) ||
    typeof request.input.open !== "function" ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    (request.compileMs !== undefined &&
      (!Number.isSafeInteger(request.compileMs) ||
        request.compileMs < 1 ||
        request.compileMs > 120000)) ||
    !Number.isSafeInteger(request.outputLimit) ||
    request.outputLimit < 1 ||
    !["python", "postgresql", "java", "typescript", "ocaml"].includes(request.language)
  )
    throw new Error("Invalid isolated case");
  for (const value of Object.values(request.limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid execution limits");
}
