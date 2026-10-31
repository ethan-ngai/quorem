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
  type ExecutionSpec,
  type Job,
} from "@quorem/execution";

/** Scope is fixed by server-side credential configuration and cannot be selected per request. */
export function privateRunnerCommands(options: {
  origin: string;
  secret: string;
  scope: string;
  resumable: boolean;
  timeoutMs: number;
  fetch?: typeof fetch;
}): ExecutionRepository {
  const origin = new URL(options.origin);
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
      throw new Error("Runner command unavailable");
    }
    return result;
  }
  async function json(
    op: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return (await call(op, data, signal)).json();
  }
  async function ack(
    op: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
    raw?: Uint8Array,
    extra?: Record<string, string>,
  ): Promise<void> {
    await (await call(op, data, signal, raw, extra)).json();
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
      if (data !== null && typeof data !== "string") throw new Error("Invalid claim response");
      return data === null ? null : decodeJob(data, scope);
    },
    async lease(job, heartbeat, signal) {
      const value = await json("lease", { job: j(job), heartbeat }, signal);
      if (typeof value !== "boolean") throw new Error("Invalid lease response");
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
          if (index !== ordinal || length > 2 * 1024 * 1024)
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
