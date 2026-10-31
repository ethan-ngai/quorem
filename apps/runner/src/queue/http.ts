/** @file http.ts @description Private runner client with no database credentials. @module runner */
import {
  decodeJob,
  encodeCheckpointCase,
  encodeJob,
  type AttemptFence,
  type Checkpoint,
  type CheckpointCase,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type ExecutionQueueControl,
  type ExecutionInputReader,
  type ExecutionSpec,
  type Job,
} from "@quorem/execution";

/** A failed mutation may have committed; callers must resolve its receipt, not blindly replay. */
export class RunnerCommandError extends Error {
  readonly outcome: "unknown" | "unavailable";
  constructor(outcome: "unknown" | "unavailable") {
    super(outcome === "unknown" ? "Runner command outcome unknown" : "Runner command unavailable");
    this.outcome = outcome;
  }
}

/** Scope is fixed by server-side credential configuration and cannot be selected per request. */
export function privateRunnerCommands(options: {
  origin: string;
  secret: string;
  scope: string;
  resumable: boolean;
  timeoutMs: number;
  fetch?: typeof fetch;
}): ExecutionRepository & ExecutionQueueControl & ExecutionInputReader {
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    throw new Error("Invalid private runner configuration");
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== "/" && origin.pathname !== "") ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      )) ||
    new TextEncoder().encode(options.secret).length < 32 ||
    /\s/.test(options.secret) ||
    !options.scope ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1
  )
    throw new Error("Invalid private runner configuration");
  const fetcher = options.fetch ?? fetch;
  async function call(
    op: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
    raw?: Uint8Array,
    extra?: Record<string, string>,
  ): Promise<Response> {
    const outcome = [
      "expired",
      "load",
      "checkpoint",
      "replay",
      "state",
      "empty",
      "deadline",
      "manifest",
      "caseref",
      "input",
    ].includes(op)
      ? "unavailable"
      : "unknown";
    try {
      const result = await fetcher(new URL(`/internal/runner/${op}`, origin), {
        method: "POST",
        redirect: "manual",
        headers: { authorization: `Bearer ${options.secret}`, ...extra },
        body: raw ? new Uint8Array(raw) : JSON.stringify(data),
        signal: AbortSignal.any([
          AbortSignal.timeout(options.timeoutMs),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!result.ok) {
        await result.body?.cancel();
        throw new RunnerCommandError(outcome);
      }
      return result;
    } catch {
      throw new RunnerCommandError(outcome);
    }
  }
  async function json(
    op: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await (await call(op, data, signal)).json();
    } catch (error) {
      if (error instanceof RunnerCommandError) throw error;
      throw new RunnerCommandError(op === "claim" || op === "lease" ? "unknown" : "unavailable");
    }
  }
  async function ack(
    op: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
    raw?: Uint8Array,
    extra?: Record<string, string>,
  ): Promise<void> {
    try {
      await (await call(op, data, signal, raw, extra)).json();
    } catch (error) {
      if (error instanceof RunnerCommandError) throw error;
      throw new RunnerCommandError("unknown");
    }
  }
  const j = (job: Job) => {
    if (job.sandboxScope !== options.scope) throw new Error("Runner scope mismatch");
    return encodeJob(job);
  };
  const proof = (scope: string, fence: AttemptFence | null) => {
    if (scope !== options.scope || (fence && fence.sandboxScope !== scope))
      throw new Error("Runner scope mismatch");
    return fence?.attemptId ?? null;
  };
  return {
    async inputManifest(job, signal) {
      const value = (await json(
        "manifest",
        { job: j(job) },
        signal,
      )) as import("@quorem/execution").InputManifest;
      const validRef = (ref: { hash: string; size: number }) =>
        ref &&
        /^[a-f0-9]{64}$/.test(ref.hash) &&
        Number.isSafeInteger(ref.size) &&
        ref.size >= 0 &&
        ref.size <= 1073741823;
      if (
        !value ||
        (value.kind !== "run" && value.kind !== "submit") ||
        (value.level !== null && (!Number.isSafeInteger(value.level) || value.level < 1)) ||
        !Number.isInteger(value.caseCount) ||
        value.caseCount < 0 ||
        value.caseCount > 320 ||
        !Number.isInteger(value.sampleCount) ||
        value.sampleCount < 0 ||
        value.sampleCount > 320 ||
        typeof value.privateDetails !== "boolean" ||
        typeof value.submitCasesAreSamples !== "boolean" ||
        (value.submitCasesAreSamples &&
          (!value.privateDetails || value.caseCount !== value.sampleCount)) ||
        value.caseCount + (value.submitCasesAreSamples ? 0 : value.sampleCount) > 320 ||
        !/^[a-f0-9]{64}$/.test(value.suiteHash) ||
        !validRef(value.source) ||
        !validRef(value.metadata)
      )
        throw new RunnerCommandError("unavailable");
      return value;
    },
    async inputCaseRef(job, ordinal, signal) {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 319)
        throw new Error("Invalid input ordinal");
      const value = (await json(
        "caseref",
        { job: j(job), ordinal },
        signal,
      )) as import("@quorem/execution").InputCaseRef;
      if (
        !value ||
        !/^[a-f0-9]{64}$/.test(value.hash) ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0 ||
        value.size > 1073741823 ||
        !["public", "sample", "private"].includes(value.channel)
      )
        throw new RunnerCommandError("unavailable");
      return value;
    },
    async inputPage(job, kind, ordinal, offset, signal) {
      if (
        !["source", "metadata", "case"].includes(kind) ||
        !Number.isSafeInteger(ordinal) ||
        (kind === "case" ? ordinal < 0 || ordinal > 319 : ordinal !== 0) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 1073741823
      )
        throw new Error("Invalid input page");
      const response = await call("input", { job: j(job), kind, ordinal, offset }, signal);
      const hash = response.headers.get("x-input-hash") ?? "",
        rawSize = response.headers.get("x-input-size") ?? "",
        size = Number(rawSize),
        rawChannel = response.headers.get("x-input-channel");
      const channel = rawChannel === "none" ? null : rawChannel;
      if (
        !/^[a-f0-9]{64}$/.test(hash) ||
        !/^(0|[1-9][0-9]*)$/.test(rawSize) ||
        !Number.isSafeInteger(size) ||
        size > 1073741823 ||
        offset > size ||
        (kind === "case"
          ? !["public", "sample", "private"].includes(channel ?? "")
          : channel !== null) ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new RunnerCommandError("unavailable");
      }
      const reader = response.body.getReader(),
        bytes = new Uint8Array(Math.min(65536, size - offset));
      let count = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          if (count + part.value.length > bytes.length) throw new Error("Input page too large");
          bytes.set(part.value, count);
          count += part.value.length;
        }
        if (count !== bytes.length) throw new Error("Incomplete input page");
      } catch {
        await reader.cancel();
        throw new RunnerCommandError("unavailable");
      } finally {
        reader.releaseLock();
      }
      return { hash, size, channel: channel as "public" | "sample" | "private" | null, bytes };
    },
    async queueState(signal) {
      const value = (await json("state", {}, signal)) as { queued: number; running: number };
      if (
        !value ||
        !Number.isSafeInteger(value.queued) ||
        value.queued < 0 ||
        !Number.isSafeInteger(value.running) ||
        value.running < 0
      )
        throw new RunnerCommandError("unavailable");
      return value;
    },
    async confirmQueueEmpty(signal) {
      const value = await json("empty", {}, signal);
      if (typeof value !== "boolean") throw new RunnerCommandError("unavailable");
      return value;
    },
    async nextRunnableDeadline(scope, signal) {
      proof(scope, null);
      const value = await json("deadline", {}, signal);
      if (
        value !== null &&
        (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      )
        throw new RunnerCommandError("unavailable");
      return value;
    },
    async nextExpiredAttempt(resumable, scope, signal) {
      if (resumable !== options.resumable) throw new Error("Capability mismatch");
      proof(scope, null);
      const value = await json("expired", {}, signal);
      if (value === null) return null;
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as AttemptFence).attemptId !== "string" ||
        !(value as AttemptFence).attemptId ||
        (value as AttemptFence).sandboxScope !== scope
      )
        throw new Error("Invalid attempt response");
      return value as AttemptFence;
    },
    async claimAfterTeardown(resumable, scope, confirmed, signal) {
      if (resumable !== options.resumable) throw new Error("Capability mismatch");
      const data = await json("claim", { attemptId: proof(scope, confirmed) }, signal);
      if (data === null) return null;
      if (typeof data !== "string") throw new RunnerCommandError("unknown");
      try {
        return decodeJob(data, scope);
      } catch {
        throw new RunnerCommandError("unknown");
      }
    },
    async lease(job, heartbeat, signal) {
      const value = await json("lease", { job: j(job), heartbeat }, signal);
      if (typeof value !== "boolean") throw new RunnerCommandError("unknown");
      return value;
    },
    async load(job, signal) {
      return (await json("load", { job: j(job) }, signal)) as ExecutionSpec;
    },
    async beginCompletion(job, header: CompletionHeader, signal) {
      await ack("begin", { job: j(job), header }, signal);
    },
    async writeCompletionChunk(job, chunk: CompletionFieldChunk, signal) {
      const metadata = JSON.stringify({
        job: j(job),
        channel: chunk.channel,
        ordinal: chunk.ordinal,
        field: chunk.field,
        chunkOrdinal: chunk.chunkOrdinal,
      });
      await ack("chunk", {}, signal, chunk.bytes, { "x-runner-command": metadata });
    },
    async sealCompletionFrame(job, channel, ordinal, status, signal) {
      await ack("seal", { job: j(job), channel, ordinal, status }, signal);
    },
    async sealCompletionDiagnostics(job, signal) {
      await ack("diagnostics", { job: j(job) }, signal);
    },
    async finishCompletionStream(job, fence, signal) {
      await ack("eof", { job: j(job), attemptId: proof(options.scope, fence) }, signal);
    },
    async promoteCompletion(job, fence, signal) {
      await ack("promote", { job: j(job), attemptId: proof(options.scope, fence) }, signal);
    },
    async loadCheckpoint(job, signal) {
      const v = (await json("checkpoint", { job: j(job) }, signal)) as {
        nextOrdinal: number;
        artifact?: string;
        fatal?: string;
        compilationNanos: string;
      };
      return { ...v, compilationNanos: BigInt(v.compilationNanos) } as Checkpoint;
    },
    async saveCheckpoint(job, value: CheckpointCase, signal) {
      await ack("save", {}, signal, new TextEncoder().encode(encodeCheckpointCase(value)), {
        "x-runner-job": j(job),
      });
    },
    async yield(job, fence, signal) {
      await ack("yield", { job: j(job), attemptId: proof(options.scope, fence) }, signal);
    },
    async replayCheckpoint(job, count, consume, signal) {
      const response = await call("replay", { job: j(job), count }, signal);
      if (!response.body) throw new Error("Missing checkpoint stream");
      const reader = response.body.getReader();
      let pending = new Uint8Array(0),
        offset = 0;
      const read = async (size: number): Promise<Uint8Array | null> => {
        const value = new Uint8Array(size);
        let at = 0;
        while (at < size) {
          if (offset === pending.length) {
            const next = await reader.read();
            if (next.done) {
              if (at === 0) return null;
              throw new Error("Truncated checkpoint stream");
            }
            pending = new Uint8Array(next.value);
            offset = 0;
            continue;
          }
          const n = Math.min(size - at, pending.length - offset);
          value.set(pending.subarray(offset, offset + n), at);
          at += n;
          offset += n;
        }
        return value;
      };
      try {
        let ordinal = 0;
        while (true) {
          const header = await read(8);
          if (!header) break;
          const v = new DataView(header.buffer),
            index = v.getUint32(0),
            length = v.getUint32(4);
          if (index !== ordinal || length > 2 * 1024 * 1024 + 4096)
            throw new Error("Invalid checkpoint stream");
          const frame = await read(length);
          if (frame === null) throw new Error("Truncated checkpoint stream");
          await consume(index, frame);
          ordinal++;
        }
        if (ordinal !== count) throw new Error("Incomplete checkpoint stream");
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
  };
}
