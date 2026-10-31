/** @file contracts.ts @description Private judge and repository contracts. @module execution */
import type { ExecutionLimits } from "@quorem/questions";

export interface AttemptFence {
  readonly attemptId: string;
  readonly sandboxScope: string;
}
export interface Job extends AttemptFence {
  readonly language: string;
  readonly jobId: string;
  readonly submissionId: string;
  readonly problemVersionId: string;
  readonly runtimeRevision: string;
  readonly harnessRevision: string;
  readonly sourceRef: string;
  readonly suiteRef: string;
  readonly limits: ExecutionLimits;
}
export type Verdict =
  | "accepted"
  | "wrong_answer"
  | "syntax_error"
  | "runtime_error"
  | "time_limit"
  | "memory_limit"
  | "output_limit"
  | "invalid_output";
export interface Diagnostic {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}
/** Raw JSON fields retain number lexemes and never pass through JSONB. */
export interface CaseResult {
  readonly index: number;
  readonly status: string;
  readonly sqlTypes?: readonly string[];
  readonly stdout?: string;
  readonly stderr?: string;
  readonly actual?: string;
  readonly expected?: string;
  readonly diagnostics?: readonly Diagnostic[];
}
export interface Completion {
  readonly submissionId: string;
  readonly attemptId: string;
  readonly verdict?: Verdict;
  readonly score?: { readonly passed: number; readonly total: number };
  readonly safeDiagnostics?: readonly Diagnostic[];
  readonly publicCaseResults?: readonly CaseResult[];
  readonly submitSampleResults?: readonly CaseResult[];
  readonly privateCaseResults?: readonly CaseResult[];
  readonly hiddenCases?: readonly { readonly index: number; readonly status: Verdict }[];
  readonly engineFailure?: string;
}
/** Small terminal metadata; case bodies travel separately in bounded frames. */
export interface CompletionHeader {
  readonly submissionId: string;
  readonly attemptId: string;
  readonly verdict?: Verdict;
  readonly score?: { readonly passed: number; readonly total: number };
  readonly hiddenCases?: readonly { readonly index: number; readonly status: Verdict }[];
  readonly engineFailure: boolean;
  readonly diagnosticsPresent: boolean;
  readonly publicPresent: boolean;
  readonly samplePresent: boolean;
  readonly privatePresent: boolean;
  readonly publicCount: number;
  readonly sampleCount: number;
  readonly privateCount: number;
}
/** A raw JSON field is transported independently in bounded byte chunks. */
export interface CompletionFieldChunk {
  readonly channel: "public" | "sample" | "private" | "header";
  readonly ordinal: number;
  readonly field: "actual" | "expected" | "stdout" | "stderr" | "diagnostics" | "sqlTypes";
  readonly chunkOrdinal: number;
  readonly bytes: Uint8Array;
}
/** Case payloads are raw JSON so precision and private values survive transport. */
export interface ExecutionSpec {
  readonly problemJson: string;
  readonly source: string;
  readonly kind: "run" | "submit";
  readonly cases: readonly string[];
  readonly submitSamples: readonly string[];
  readonly submitCasesAreSamples: boolean;
  readonly privateDetails: boolean;
}
export interface Checkpoint {
  readonly nextOrdinal: number;
  readonly artifact?: string;
  readonly compilationNanos: bigint;
  readonly fatal?: string;
}
export interface CheckpointCase {
  readonly ordinal: number;
  readonly frame: string;
  readonly artifact?: string;
  readonly compilationNanos: bigint;
  readonly fatal?: string;
}
/** Identity is compared as a pair; scope alone or attempt alone never authorizes reclamation. */
export function sameAttempt(a: AttemptFence, b: AttemptFence): boolean {
  return (
    !!a.attemptId &&
    !!a.sandboxScope &&
    a.attemptId === b.attemptId &&
    a.sandboxScope === b.sandboxScope
  );
}
/** Assert exact expired-attempt and sandbox scope before using teardown evidence. */
export function assertAttemptFence(expected: AttemptFence, confirmed: AttemptFence): void {
  if (!sameAttempt(expected, confirmed)) throw new Error("attempt fence mismatch");
}
export interface SandboxControl {
  teardownAttempt(fence: AttemptFence, signal?: AbortSignal): Promise<void>;
}
export interface ExecutionEngine {
  execute(job: Job, signal?: AbortSignal): Promise<Completion>;
}
export interface ExecutionQueueControl {
  queueState(signal?: AbortSignal): Promise<{ queued: number; running: number }>;
  confirmQueueEmpty(signal?: AbortSignal): Promise<boolean>;
  nextRunnableDeadline(scope: string, signal?: AbortSignal): Promise<number | null>;
}
export interface ExecutionRepository {
  nextExpiredAttempt(
    resumable: boolean,
    scope: string,
    signal?: AbortSignal,
  ): Promise<AttemptFence | null>;
  claimAfterTeardown(
    resumable: boolean,
    scope: string,
    confirmed: AttemptFence | null,
    signal?: AbortSignal,
  ): Promise<Job | null>;
  load(job: Job, signal?: AbortSignal): Promise<ExecutionSpec>;
  lease(job: Job, heartbeat: boolean, signal?: AbortSignal): Promise<boolean>;
  beginCompletion(job: Job, header: CompletionHeader, signal?: AbortSignal): Promise<void>;
  writeCompletionChunk(job: Job, chunk: CompletionFieldChunk, signal?: AbortSignal): Promise<void>;
  sealCompletionFrame(
    job: Job,
    channel: "public" | "sample" | "private",
    ordinal: number,
    status: string,
    signal?: AbortSignal,
  ): Promise<void>;
  sealCompletionDiagnostics(job: Job, signal?: AbortSignal): Promise<void>;
  finishCompletionStream(job: Job, proof: AttemptFence, signal?: AbortSignal): Promise<void>;
  promoteCompletion(job: Job, proof: AttemptFence, signal?: AbortSignal): Promise<void>;
  loadCheckpoint(job: Job, signal?: AbortSignal): Promise<Checkpoint>;
  replayCheckpoint(
    job: Job,
    count: number,
    consume: (ordinal: number, frame: Uint8Array) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  saveCheckpoint(job: Job, checkpoint: CheckpointCase, signal?: AbortSignal): Promise<void>;
  yield(job: Job, proof: AttemptFence, signal?: AbortSignal): Promise<void>;
}

/** Ensure completion belongs to the claimed submission and attempt. */
export function assertCompletion(job: Job, completion: Completion): void {
  if (
    !job.sandboxScope ||
    !job.attemptId ||
    completion.attemptId !== job.attemptId ||
    completion.submissionId !== job.submissionId
  )
    throw new Error("completion fence mismatch");
}

/** Reject scope mismatches before passing teardown evidence to an atomic claim. */
export function assertClaimFence(scope: string, confirmed: AttemptFence | null): void {
  if (!scope || (confirmed !== null && (!confirmed.attemptId || confirmed.sandboxScope !== scope)))
    throw new Error("claim fence mismatch");
}
