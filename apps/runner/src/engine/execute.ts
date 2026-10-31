/** @file execute.ts @description Manifest-bound, checkpointed case orchestration. @module runner */
import {
  decodeJudgeFrame,
  encodeJudgeFrame,
  decodeManifestCheckpointFrame,
  encodeManifestCheckpointFrame,
  manifestCheckpointProvenance,
  manifestInvocationBinding,
  assertManifestCheckpoint,
  runtimeForRevision,
  validateCompiledArtifact,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type ExecutionInputReader,
  type Job,
  type JudgeFrame,
} from "@quorem/execution";
import { CaseDeadline, CaseOutputLimit } from "../sandbox/budget.ts";
import type { IsolatedSandbox } from "../sandbox/types.ts";
import { assertCaseFailure, assertCaseOutput } from "../sandbox/proof.ts";
import { spoolInput } from "../checkpoints/input-spool.ts";
import { streamedCaseRequest } from "./request-stream.ts";
import { harnessFrame } from "./frame.ts";
const encoder = new TextEncoder();
const failFrame = (status: string): JudgeFrame => ({
  status,
  actual: "null",
  stdout: "",
  stderr: "",
  line: 0,
});
async function field(
  repository: ExecutionRepository,
  job: Job,
  channel: CompletionFieldChunk["channel"],
  ordinal: number,
  name: CompletionFieldChunk["field"],
  raw: string,
  signal?: AbortSignal,
) {
  const bytes = encoder.encode(raw);
  for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++)
    await repository.writeCompletionChunk(
      job,
      {
        channel,
        ordinal,
        field: name,
        chunkOrdinal: index,
        bytes: bytes.subarray(offset, offset + 65536),
      },
      signal,
    );
}
/** A persisted case boundary can be yielded only after teardown. */
export class ExecutionYield extends Error {
  constructor() {
    super("Execution checkpoint ready to yield");
  }
}
/** Only one immutable case and one checkpoint frame are held at once. */
export async function executeAndStage(
  job: Job,
  repository: ExecutionRepository & ExecutionInputReader,
  sandbox: IsolatedSandbox,
  signal?: AbortSignal,
  shouldYield?: () => boolean,
): Promise<CompletionHeader> {
  const runtime = runtimeForRevision(job.runtimeRevision, job.harnessRevision);
  if (!runtime || runtime.language !== job.language)
    throw new Error("Unsupported execution runtime");
  const manifest = await repository.inputManifest(job, signal),
    total = manifest.caseCount + (manifest.submitCasesAreSamples ? 0 : manifest.sampleCount);
  if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647)
    throw new Error("Invalid admitted suite");
  const source = await spoolInput({
    reader: repository,
    job,
    kind: "source",
    ordinal: 0,
    expected: manifest.source,
    signal,
  });
  try {
    const metadata = await spoolInput({
      reader: repository,
      job,
      kind: "metadata",
      ordinal: 0,
      expected: manifest.metadata,
      signal,
    });
    try {
      const checkpoint = await repository.loadCheckpoint(job, signal);
      if (
        checkpoint.nextOrdinal < 0 ||
        checkpoint.nextOrdinal > total ||
        checkpoint.compilationNanos < 0n ||
        checkpoint.compilationNanos > 120000000000n
      )
        throw new Error("Invalid checkpoint");
      let artifact = checkpoint.artifact,
        compilation = checkpoint.compilationNanos,
        fatal = checkpoint.fatal ? decodeJudgeFrame(checkpoint.fatal) : undefined;
      if (checkpoint.nextOrdinal > 0)
        await repository.replayCheckpoint(
          job,
          checkpoint.nextOrdinal,
          async (ordinal, bytes) => {
            const envelope = decodeManifestCheckpointFrame(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
            const ref = await repository.inputCaseRef(job, ordinal, signal);
            await assertManifestCheckpoint(
              job,
              manifest,
              ref,
              ordinal,
              envelope.provenance,
              false,
              envelope.frame,
              ordinal === checkpoint.nextOrdinal - 1 ? checkpoint : undefined,
            );
          },
          signal,
        );
      else if (artifact || fatal || compilation !== 0n)
        throw new Error("Unbound checkpoint metadata");
      if (artifact) validateCompiledArtifact(artifact, job.language);
      if (fatal && (fatal.status !== "syntax_error" || job.language === "postgresql"))
        throw new Error("Invalid checkpoint fatal");
      for (let ordinal = checkpoint.nextOrdinal; ordinal < total; ordinal++) {
        signal?.throwIfAborted();
        if (ordinal > checkpoint.nextOrdinal && shouldYield?.()) throw new ExecutionYield();
        const ref = await repository.inputCaseRef(job, ordinal, signal);
        let frame: JudgeFrame;
        const compiled = !["python", "postgresql"].includes(job.language);
        if (fatal) frame = { ...fatal, artifact: undefined };
        else if (compiled && !artifact && compilation >= 60000000000n)
          frame = failFrame("time_limit");
        else {
          const testcase = await spoolInput({
            reader: repository,
            job,
            kind: "case",
            ordinal,
            expected: ref,
            expectedChannel: ref.channel,
            signal,
          });
          try {
            const operation = compiled ? (artifact ? "execute" : "compile-execute") : "direct";
            const remaining = Math.max(1, Math.ceil(Number(60000000000n - compilation) / 1000000));
            const { input } = await streamedCaseRequest({
              source,
              metadata,
              testcase,
              level: manifest.level,
              operation,
              language: job.language,
              artifact,
              signal,
            });
            const request = {
              fence: job,
              binding: await manifestInvocationBinding(
                job,
                manifest,
                ref,
                ordinal,
                job,
                input.hash,
              ),
              ordinal,
              language: job.language,
              limits: job.limits,
              input,
              outputLimit: compiled && !artifact ? 4 * 1024 * 1024 : job.limits.outputBytes,
              timeoutMs: Math.max(90000, remaining + job.limits.wallTimeMs + 70000),
              compileMs: Math.min(120000, remaining),
            };
            try {
              const result = await sandbox.runCase(request, signal);
              assertCaseOutput(request, result);
              frame = harnessFrame(result, job.language, job.limits.outputBytes);
              if (compiled && !artifact)
                compilation += BigInt(Math.ceil((result.compilationMs ?? 0) * 1000000));
            } catch (error) {
              if (error instanceof CaseDeadline || error instanceof CaseOutputLimit)
                assertCaseFailure(request, error);
              if (error instanceof CaseDeadline && error.phase !== "startup") {
                frame = failFrame("time_limit");
                if (error.phase === "compile") compilation = 60000000000n;
              } else if (error instanceof CaseOutputLimit) frame = failFrame("output_limit");
              else throw error;
            }
            if (frame.artifact) {
              validateCompiledArtifact(frame.artifact, job.language);
              artifact = frame.artifact;
            }
            if (frame.status === "syntax_error" && job.language !== "postgresql") fatal = frame;
          } finally {
            await testcase.dispose();
          }
        }
        const stored: JudgeFrame = {
          ...frame,
          artifact: undefined,
          ...(manifest.kind === "submit" && !manifest.privateDetails && ordinal < manifest.caseCount
            ? { stdout: "", stderr: "", line: 0 }
            : {}),
        };
        const fatalRaw = fatal ? encodeJudgeFrame({ ...fatal, artifact: undefined }) : undefined;
        const provenance = await manifestCheckpointProvenance(
          job,
          manifest,
          ref,
          ordinal,
          job,
          { artifact, fatal: fatalRaw, compilationNanos: compilation },
          stored,
        );
        await repository.saveCheckpoint(
          job,
          {
            ordinal,
            frame: encodeManifestCheckpointFrame(stored, provenance),
            artifact: frame.artifact,
            compilationNanos: compilation,
            fatal: fatalRaw,
          },
          signal,
        );
      }
      const publicCount = manifest.kind === "run" ? manifest.caseCount : 0,
        sampleCount =
          manifest.kind === "submit" && !manifest.submitCasesAreSamples ? manifest.sampleCount : 0,
        privateCount = manifest.kind === "submit" ? manifest.caseCount : 0;
      const header: CompletionHeader = {
        submissionId: job.submissionId,
        attemptId: job.attemptId,
        engineFailure: false,
        diagnosticsPresent: false,
        publicPresent: publicCount > 0,
        samplePresent: sampleCount > 0,
        privatePresent: privateCount > 0,
        publicCount,
        sampleCount,
        privateCount,
      };
      await repository.beginCompletion(job, header, signal);
      await repository.replayCheckpoint(
        job,
        total,
        async (ordinal, bytes) => {
          const envelope = decodeManifestCheckpointFrame(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
          const ref = await repository.inputCaseRef(job, ordinal, signal);
          await assertManifestCheckpoint(
            job,
            manifest,
            ref,
            ordinal,
            envelope.provenance,
            false,
            envelope.frame,
          );
          const frame = envelope.frame,
            sample = ordinal >= manifest.caseCount;
          const channel = manifest.kind === "run" ? "public" : sample ? "sample" : "private",
            index = sample ? ordinal - manifest.caseCount : ordinal;
          if (frame.actual !== undefined && frame.status === "executed")
            await field(repository, job, channel, index, "actual", frame.actual, signal);
          if (frame.stdout)
            await field(
              repository,
              job,
              channel,
              index,
              "stdout",
              JSON.stringify(frame.stdout),
              signal,
            );
          let stderr = frame.stderr;
          const diagnostics: { message: string; line?: number }[] = [];
          if (job.language === "postgresql" && frame.status !== "executed" && stderr) {
            diagnostics.push({ message: stderr, ...(frame.line ? { line: frame.line } : {}) });
            stderr = "";
          } else if (frame.line) diagnostics.push({ message: "Syntax error", line: frame.line });
          if (stderr)
            await field(repository, job, channel, index, "stderr", JSON.stringify(stderr), signal);
          if (diagnostics.length)
            await field(
              repository,
              job,
              channel,
              index,
              "diagnostics",
              JSON.stringify(diagnostics),
              signal,
            );
          if (frame.sqlTypes?.length && frame.status === "executed")
            await field(
              repository,
              job,
              channel,
              index,
              "sqlTypes",
              JSON.stringify(frame.sqlTypes),
              signal,
            );
          await repository.sealCompletionFrame(job, channel, index, frame.status, signal);
        },
        signal,
      );
      return header;
    } finally {
      await metadata.dispose();
    }
  } finally {
    await source.dispose();
  }
}
