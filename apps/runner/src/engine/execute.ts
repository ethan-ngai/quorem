/** @file execute.ts @description Manifest-bound, checkpointed case orchestration. @module runner */
import {
  CASE_LANES,
  CASE_WINDOW_BYTES,
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
  type InputCaseRef,
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
function* field(
  channel: CompletionFieldChunk["channel"],
  ordinal: number,
  name: CompletionFieldChunk["field"],
  raw: string,
): Generator<CompletionFieldChunk> {
  const bytes = encoder.encode(raw);
  for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++)
    yield {
      channel,
      ordinal,
      field: name,
      chunkOrdinal: index,
      bytes: bytes.subarray(offset, offset + 65536),
    };
}
/** A persisted case boundary can be yielded only after teardown. */
export class ExecutionYield extends Error {
  constructor() {
    super("Execution checkpoint ready to yield");
  }
}
/** Bounded native lanes; checkpoints commit in order before final publication. */
export async function executeAndStage(
  job: Job,
  repository: ExecutionRepository & ExecutionInputReader,
  sandbox: IsolatedSandbox,
  externalSignal?: AbortSignal,
  shouldYield?: () => boolean | Promise<boolean>,
  onFinalCase?: () => void,
  caseConcurrency = 1,
): Promise<CompletionHeader> {
  if (!Number.isInteger(caseConcurrency) || caseConcurrency < 1 || caseConcurrency > CASE_LANES)
    throw new Error("Invalid case concurrency");
  const controller = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal;
  const runtime = runtimeForRevision(job.runtimeRevision, job.harnessRevision);
  if (!runtime || runtime.language !== job.language)
    throw new Error("Unsupported execution runtime");
  const [bundle, checkpoint] = await Promise.all([
    repository.inputBundle?.(job, 0, true, signal),
    repository.loadCheckpoint(job, signal),
  ]);
  const manifest = bundle?.manifest ?? (await repository.inputManifest(job, signal)),
    total = manifest.caseCount + (manifest.submitCasesAreSamples ? 0 : manifest.sampleCount);
  if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647)
    throw new Error("Invalid admitted suite");
  const inputs = bundle
    ? {
        ...repository,
        inputCaseRef(job: Job, ordinal: number, signal?: AbortSignal) {
          return ordinal === 0 && bundle.ref
            ? Promise.resolve(bundle.ref)
            : repository.inputCaseRef(job, ordinal, signal);
        },
        inputPage(...args: Parameters<ExecutionInputReader["inputPage"]>) {
          const [, kind, ordinal, offset] = args;
          const cached =
            offset === 0 && ordinal === 0
              ? kind === "case"
                ? bundle.testcase
                : bundle[kind]
              : undefined;
          return cached ? Promise.resolve(cached) : repository.inputPage(...args);
        },
      }
    : repository;
  const source = await spoolInput({
    reader: inputs,
    job,
    kind: "source",
    ordinal: 0,
    expected: manifest.source,
    signal,
  });
  try {
    const metadata = await spoolInput({
      reader: inputs,
      job,
      kind: "metadata",
      ordinal: 0,
      expected: manifest.metadata,
      signal,
    });
    try {
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
      async function stage(ordinal: number, frame: JudgeFrame): Promise<void> {
        const sample = ordinal >= manifest.caseCount;
        const channel = manifest.kind === "run" ? "public" : sample ? "sample" : "private";
        const index = sample ? ordinal - manifest.caseCount : ordinal;
        let chunks: CompletionFieldChunk[] = [];
        const flush = async () => {
          if (chunks.length) await repository.writeCompletionChunks(job, chunks, signal);
          chunks = [];
        };
        const append = async (name: CompletionFieldChunk["field"], raw: string) => {
          for (const chunk of field(channel, index, name, raw)) {
            chunks.push(chunk);
            if (chunks.length === 16) await flush();
          }
        };
        if (frame.actual !== undefined && frame.status === "executed")
          await append("actual", frame.actual);
        if (frame.stdout) await append("stdout", JSON.stringify(frame.stdout));
        let stderr = frame.stderr;
        const diagnostics: { message: string; line?: number }[] = [];
        if (job.language === "postgresql" && frame.status !== "executed" && stderr) {
          diagnostics.push({ message: stderr, ...(frame.line ? { line: frame.line } : {}) });
          stderr = "";
        } else if (frame.line) diagnostics.push({ message: "Syntax error", line: frame.line });
        if (stderr) await append("stderr", JSON.stringify(stderr));
        if (diagnostics.length) await append("diagnostics", JSON.stringify(diagnostics));
        if (frame.sqlTypes?.length && frame.status === "executed")
          await append("sqlTypes", JSON.stringify(frame.sqlTypes));
        await flush();
        await repository.sealCompletionFrame(job, channel, index, frame.status, signal);
      }
      if (checkpoint.nextOrdinal > 0)
        await repository.replayCheckpoint(
          job,
          checkpoint.nextOrdinal,
          async (ordinal, bytes) => {
            const envelope = decodeManifestCheckpointFrame(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
            const ref = await inputs.inputCaseRef(job, ordinal, signal);
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
            await stage(ordinal, envelope.frame);
          },
          signal,
        );
      else if (artifact || fatal || compilation !== 0n)
        throw new Error("Unbound checkpoint metadata");
      if (artifact) validateCompiledArtifact(artifact, job.language);
      if (fatal && (fatal.status !== "syntax_error" || job.language === "postgresql"))
        throw new Error("Invalid checkpoint fatal");
      const compiled = !["python", "postgresql"].includes(job.language);
      async function executeCase(
        ordinal: number,
        initial: { artifact?: string; compilation: bigint; fatal?: JudgeFrame },
        ref: InputCaseRef,
      ) {
        let { artifact, compilation, fatal } = initial;
        let frame: JudgeFrame;

        if (fatal) frame = { ...fatal, artifact: undefined };
        else if (compiled && !artifact && compilation >= 60000000000n)
          frame = failFrame("time_limit");
        else {
          const testcase = await spoolInput({
            reader: inputs,
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
        return { frame, ref, artifact, compilation, fatal };
      }
      const pending: Promise<void>[] = [];
      try {
        for (let start = checkpoint.nextOrdinal; start < total;) {
          signal.throwIfAborted();
          if (start > checkpoint.nextOrdinal && (await shouldYield?.())) {
            await Promise.all(pending);
            throw new ExecutionYield();
          }
          // Compile before fanout; each lane then receives the same immutable artifact.
          const requested = Math.min(
            compiled && !artifact && !fatal ? 1 : caseConcurrency,
            total - start,
          );
          const refs = await Promise.all(
            Array.from({ length: requested }, (_, index) =>
              inputs.inputCaseRef(job, start + index, signal),
            ),
          );
          const laneBytes =
            Math.max(1, ...refs.map((ref) => ref.size)) +
            (artifact ? Buffer.byteLength(artifact) : 0);
          const width = Math.min(requested, Math.max(1, Math.floor(CASE_WINDOW_BYTES / laneBytes)));
          const runs = Array.from({ length: width }, (_, index) =>
            executeCase(start + index, { artifact, compilation, fatal }, refs[index]).catch(
              (error) => {
                controller.abort(error);
                throw error;
              },
            ),
          );
          const outcomes = await Promise.allSettled(runs);
          const failed = outcomes.find((value) => value.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          const results = outcomes.map(
            (value) =>
              (value as PromiseFulfilledResult<Awaited<ReturnType<typeof executeCase>>>).value,
          );
          if (start + width === total) onFinalCase?.();
          for (let index = 0; index < results.length; index++) {
            const ordinal = start + index;
            const { frame, ref } = results[index];
            artifact = results[index].artifact ?? artifact;
            if (results[index].compilation > compilation) compilation = results[index].compilation;
            fatal ??= results[index].fatal;
            const stored: JudgeFrame = {
              ...frame,
              artifact: undefined,
              ...(manifest.kind === "submit" &&
              !manifest.privateDetails &&
              ordinal < manifest.caseCount
                ? { stdout: "", stderr: "", line: 0 }
                : {}),
            };
            // A one-case Run can retry its only case without resuming a partial suite.
            if (!(repository.finalizeCompletion && manifest.kind === "run" && total === 1)) {
              const fatalRaw = fatal
                ? encodeJudgeFrame({ ...fatal, artifact: undefined })
                : undefined;
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
            const staged = stage(ordinal, stored).catch((error) => {
              controller.abort(error);
              throw error;
            });
            void staged.catch(() => {});
            pending.push(staged);
          }
          start += width;
          // At most two windows of result staging can overlap native execution.
          if (pending.length >= caseConcurrency * 2) {
            await Promise.all(pending.slice(0, width));
            void pending.splice(0, width);
          }
        }
        await Promise.all(pending);
        return header;
      } finally {
        controller.abort();
        await Promise.allSettled(pending);
      }
    } finally {
      await metadata.dispose();
    }
  } finally {
    await source.dispose();
  }
}
