/** @file execute.ts @description Checkpointed, source-bound case orchestration. @module runner */
import {
  decodeJudgeFrame,
  encodeJudgeFrame,
  decodeCheckpointFrame,
  encodeCheckpointFrame,
  checkpointProvenance,
  caseInvocationBinding,
  assertCheckpointProvenance,
  runtimeForRevision,
  validateCompiledArtifact,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type Job,
  type JudgeFrame,
  type Verdict,
} from "@quorem/execution";
import {
  compareCodingCase,
  compareSqlResult,
  parseLosslessJson,
  stringifyLosslessJson,
  type QuestionProblem,
  type Signature,
} from "@quorem/questions";
import { CaseDeadline, CaseOutputLimit } from "../sandbox/budget.ts";
import type { IsolatedSandbox } from "../sandbox/types.ts";
import { assertCaseFailure, assertCaseOutput } from "../sandbox/proof.ts";
import { caseRequest, object, problemMetadata } from "./request.ts";
import { harnessFrame } from "./frame.ts";

const encoder = new TextEncoder();
const failFrame = (status: string): JudgeFrame => ({
  status,
  actual: "null",
  stdout: "",
  stderr: "",
  line: 0,
});
type Compared = { status: string; actual?: string; expected?: string; typeMismatch: boolean };
function compare(
  problem: QuestionProblem,
  methods: readonly Signature[],
  rawCase: string,
  frame: JudgeFrame,
): Compared {
  if (problem.sql) {
    const value = object(parseLosslessJson(rawCase));
    return compareSqlResult(
      problem.sql,
      frame.status,
      frame.actual,
      value.expected === undefined ? undefined : stringifyLosslessJson(value.expected),
      frame.sqlTypes ?? [],
    );
  }
  return {
    ...compareCodingCase(problem.signature, methods, rawCase, frame.status, frame.actual),
    typeMismatch: false,
  };
}
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
/** Execute one case at a time; only bounded checkpoints and streamed fields cross the queue port. */
export async function executeAndStage(
  job: Job,
  repository: ExecutionRepository,
  sandbox: IsolatedSandbox,
  signal?: AbortSignal,
): Promise<CompletionHeader> {
  const runtime = runtimeForRevision(job.runtimeRevision, job.harnessRevision);
  if (!runtime || runtime.language !== job.language)
    throw new Error("Unsupported execution runtime");
  const spec = await repository.load(job, signal),
    { problem, methods } = problemMetadata(spec.problemJson),
    metadata = problem as unknown as QuestionProblem,
    signatures = Object.values(methods) as unknown as Signature[];
  if (
    spec.submitCasesAreSamples &&
    (spec.kind !== "submit" ||
      !spec.privateDetails ||
      spec.cases.length !== spec.submitSamples.length)
  )
    throw new Error("Invalid sample fallback");
  const all =
    spec.kind === "submit" && !spec.submitCasesAreSamples
      ? [...spec.cases, ...spec.submitSamples]
      : [...spec.cases];
  if (all.length > 320) throw new Error("Invalid admitted suite");
  const checkpoint = await repository.loadCheckpoint(job, signal);
  if (
    checkpoint.nextOrdinal < 0 ||
    checkpoint.nextOrdinal > all.length ||
    checkpoint.compilationNanos < 0n ||
    checkpoint.compilationNanos > 120000000000n
  )
    throw new Error("Invalid checkpoint");
  let artifact = checkpoint.artifact,
    compilation = checkpoint.compilationNanos,
    fatal = checkpoint.fatal ? decodeJudgeFrame(checkpoint.fatal) : undefined;
  if (checkpoint.nextOrdinal > 0) {
    await repository.replayCheckpoint(
      job,
      checkpoint.nextOrdinal,
      async (ordinal, bytes) => {
        const envelope = decodeCheckpointFrame(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        await assertCheckpointProvenance(
          job,
          spec,
          ordinal,
          envelope.provenance,
          false,
          envelope.frame,
          ordinal === checkpoint.nextOrdinal - 1 ? checkpoint : undefined,
        );
      },
      signal,
    );
  } else if (artifact || fatal || compilation !== 0n)
    throw new Error("Unbound checkpoint metadata");
  if (artifact) validateCompiledArtifact(artifact, job.language);
  if (fatal && (fatal.status !== "syntax_error" || job.language === "postgresql"))
    throw new Error("Invalid checkpoint fatal");
  for (let ordinal = checkpoint.nextOrdinal; ordinal < all.length; ordinal++) {
    signal?.throwIfAborted();
    let frame: JudgeFrame;
    const compiled = !["python", "postgresql"].includes(job.language);
    if (fatal) frame = { ...fatal, artifact: undefined };
    else if (compiled && !artifact && compilation >= 60000000000n) frame = failFrame("time_limit");
    else {
      const operation = compiled ? (artifact ? "execute" : "compile-execute") : "direct";
      const remaining = Math.max(1, Math.ceil(Number(60000000000n - compilation) / 1000000));
      const input = caseRequest(spec.source, problem, methods, all[ordinal], operation, artifact);
      const request = {
        fence: job,
        binding: await caseInvocationBinding(job, spec, ordinal, input),
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
    }
    compare(metadata, signatures, all[ordinal], frame);
    const stored: JudgeFrame = {
      ...frame,
      artifact: undefined,
      ...(spec.kind === "submit" && !spec.privateDetails && ordinal < spec.cases.length
        ? { stdout: "", stderr: "", line: 0 }
        : {}),
    };
    const fatalRaw = fatal ? encodeJudgeFrame({ ...fatal, artifact: undefined }) : undefined;
    const provenance = await checkpointProvenance(
      job,
      spec,
      ordinal,
      job,
      { artifact, fatal: fatalRaw, compilationNanos: compilation },
      stored,
    );
    await repository.saveCheckpoint(
      job,
      {
        ordinal,
        frame: encodeCheckpointFrame(stored, provenance),
        artifact: frame.artifact,
        compilationNanos: compilation,
        fatal: fatalRaw,
      },
      signal,
    );
  }
  let verdict: Verdict | undefined,
    passed = 0,
    allCompared = true;
  const hidden: { index: number; status: Verdict }[] = [];
  const inspect = async (ordinal: number, bytes: Uint8Array) => {
    const envelope = decodeCheckpointFrame(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    await assertCheckpointProvenance(
      job,
      spec,
      ordinal,
      envelope.provenance,
      false,
      envelope.frame,
    );
    const frame = envelope.frame;
    if (frame.artifact !== undefined) throw new Error("Invalid checkpoint frame");
    const value = compare(metadata, signatures, all[ordinal], frame),
      sample = ordinal >= spec.cases.length;
    if (!sample) {
      if (frame.status === "executed" && value.status === "accepted") passed++;
      if (value.status === "executed") allCompared = false;
      if (value.status !== "accepted" && value.status !== "executed" && !verdict)
        verdict = value.status as Verdict;
      if (spec.kind === "submit")
        hidden.push({
          index: ordinal,
          status:
            value.status === "accepted"
              ? "accepted"
              : value.status === "time_limit"
                ? "time_limit"
                : "wrong_answer",
        });
    }
  };
  await repository.replayCheckpoint(job, all.length, inspect, signal);
  if (!verdict && allCompared) verdict = "accepted";
  const publicCount = spec.kind === "run" ? spec.cases.length : 0,
    sampleCount = spec.kind === "submit" ? spec.submitSamples.length : 0,
    privateCount = spec.kind === "submit" && spec.privateDetails ? spec.cases.length : 0;
  const header: CompletionHeader = {
    submissionId: job.submissionId,
    attemptId: job.attemptId,
    verdict,
    score: spec.kind === "submit" ? { passed, total: spec.cases.length } : undefined,
    hiddenCases: spec.kind === "submit" ? hidden : undefined,
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
    all.length,
    async (ordinal, bytes) => {
      const envelope = decodeCheckpointFrame(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      await assertCheckpointProvenance(
        job,
        spec,
        ordinal,
        envelope.provenance,
        false,
        envelope.frame,
      );
      const frame = envelope.frame,
        result = compare(metadata, signatures, all[ordinal], frame),
        sample = ordinal >= spec.cases.length;
      const channels: { channel: "public" | "sample" | "private"; index: number }[] = [];
      if (spec.kind === "run") channels.push({ channel: "public", index: ordinal });
      else if (sample) channels.push({ channel: "sample", index: ordinal - spec.cases.length });
      else {
        if (spec.privateDetails) channels.push({ channel: "private", index: ordinal });
        if (spec.submitCasesAreSamples) channels.push({ channel: "sample", index: ordinal });
      }
      for (const target of channels) {
        if (result.actual !== undefined)
          await field(
            repository,
            job,
            target.channel,
            target.index,
            "actual",
            result.actual,
            signal,
          );
        if (frame.stdout)
          await field(
            repository,
            job,
            target.channel,
            target.index,
            "stdout",
            JSON.stringify(frame.stdout),
            signal,
          );
        let stderr = frame.stderr;
        const diagnostics: { message: string; line?: number }[] = [];
        if (result.typeMismatch)
          diagnostics.push({ message: "Output column types do not match the SQL schema." });
        if (
          job.language === "postgresql" &&
          result.status !== "executed" &&
          result.status !== "accepted" &&
          stderr
        ) {
          diagnostics.push({ message: stderr, ...(frame.line ? { line: frame.line } : {}) });
          stderr = "";
        } else if (frame.line) diagnostics.push({ message: "Syntax error", line: frame.line });
        if (job.language === "postgresql" && result.status === "invalid_output" && !frame.stderr)
          diagnostics.push({ message: "The query returned an invalid or unsupported result." });
        if (stderr)
          await field(
            repository,
            job,
            target.channel,
            target.index,
            "stderr",
            JSON.stringify(stderr),
            signal,
          );
        if (diagnostics.length)
          await field(
            repository,
            job,
            target.channel,
            target.index,
            "diagnostics",
            JSON.stringify(diagnostics),
            signal,
          );
        if (frame.sqlTypes?.length && metadata.sql && result.actual !== undefined)
          await field(
            repository,
            job,
            target.channel,
            target.index,
            "sqlTypes",
            JSON.stringify(frame.sqlTypes),
            signal,
          );
        await repository.sealCompletionFrame(
          job,
          target.channel,
          target.index,
          result.status,
          signal,
        );
      }
    },
    signal,
  );
  return header;
}
