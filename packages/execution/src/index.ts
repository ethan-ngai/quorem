/** @file index.ts @description Private execution contracts and codecs. @module execution */
export type {
  AttemptFence,
  Job,
  Verdict,
  Diagnostic,
  CaseResult,
  Completion,
  CompletionHeader,
  CompletionFieldChunk,
  Checkpoint,
  CheckpointCase,
  SandboxControl,
  ExecutionEngine,
  ExecutionRepository,
  ExecutionQueueControl,
  InputBlobRef,
  InputCaseRef,
  InputManifest,
  InputKind,
  InputPage,
  ExecutionInputReader,
} from "./contracts.ts";
export {
  sameAttempt,
  assertAttemptFence,
  assertCompletion,
  assertClaimFence,
} from "./contracts.ts";
export type { Runtime } from "./runtime.ts";
export { languageRuntime, runtimeForRevision, defaultLimits } from "./runtime.ts";
export { sourceHash } from "./source.ts";
export { encodeJob, decodeJob } from "./job.ts";
export {
  encodeCheckpointCase,
  decodeCheckpointCase,
  encodeCheckpoint,
  decodeCheckpoint,
} from "./checkpoint.ts";
export { decodeCaseFrames } from "./frames.ts";
export type { FrameLimits, OutputChannel } from "./frames.ts";
export { encodeCompletion, decodeCompletion } from "./completion.ts";

export { encodeJudgeFrame, decodeJudgeFrame } from "./judge-frame.ts";
export type { JudgeFrame } from "./judge-frame.ts";
export { compressCheckpointFrame, decompressCheckpointFrame } from "./checkpoint-compression.ts";
export { validateCompiledArtifact } from "./artifact.ts";

export { canonicalWorkspaceCommand, workspaceCommandFingerprint } from "./fingerprint.ts";
export { manifestCaseBinding, manifestInvocationBinding } from "./manifest-binding.ts";
export {
  manifestCheckpointProvenance,
  encodeManifestCheckpointFrame,
  decodeManifestCheckpointFrame,
  assertManifestCheckpoint,
} from "./manifest-checkpoint.ts";
export type { ManifestCheckpointProvenance } from "./manifest-checkpoint.ts";
export { verificationReceiptBytes, verifyResultReceipt } from "./verification-receipt.ts";
export type { VerificationReceipt } from "./verification-receipt.ts";
