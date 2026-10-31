/** @file http.ts @description Authenticated private runner command transport. @module judging */
import {
  decodeJob,
  decodeCheckpointCase,
  encodeJob,
  type AttemptFence,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type ExecutionQueueControl,
  type ExecutionInputReader,
  type InputKind,
} from "@quorem/execution";

export interface RunnerPeer {
  readonly inputProtocol: "manifest-v1";
  readonly secret: string;
  readonly scope: string;
  readonly resumable: boolean;
  readonly repository: (
    signal: AbortSignal,
  ) => ExecutionRepository & ExecutionQueueControl & ExecutionInputReader;
}
const encoder = new TextEncoder();
async function sha(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  let v = 0;
  for (let i = 0; i < a.length; i++) v |= a[i] ^ b[i];
  return v === 0;
}
function local(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
async function readBounded(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid command");
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid command");
  return value;
}
/** Bind each credential to one configured sandbox scope and capability profile. */
export async function createRunnerCommandHandler(peers: readonly RunnerPeer[]) {
  if (
    !peers.length ||
    peers.some(
      (p) =>
        encoder.encode(p.secret).length < 32 ||
        /\s/.test(p.secret) ||
        !p.scope ||
        p.inputProtocol !== "manifest-v1",
    )
  )
    throw new Error("Invalid runner peer configuration");
  const keys = await Promise.all(
    peers.map(async (p) => ({
      scope: p.scope,
      resumable: p.resumable,
      repository: p.repository,
      hash: await sha(p.secret),
    })),
  );
  for (let i = 0; i < keys.length; i++)
    for (let j = 0; j < i; j++)
      if (equal(keys[i].hash, keys[j].hash)) throw new Error("Duplicate runner credential");
  return async (request: Request): Promise<Response> => {
    try {
      const address = new URL(request.url);
      if (
        (address.protocol !== "https:" &&
          !(address.protocol === "http:" && local(address.hostname))) ||
        request.method !== "POST" ||
        !/^\/internal\/runner\/[a-z]+$/.test(address.pathname) ||
        address.search
      )
        return new Response(null, { status: 404 });
      const auth = request.headers.get("authorization") ?? "";
      if (!/^Bearer [^\s]+$/.test(auth)) return new Response(null, { status: 401 });
      const supplied = await sha(auth.slice(7));
      let peer: (typeof keys)[number] | undefined;
      for (const candidate of keys) if (equal(candidate.hash, supplied)) peer = candidate;
      if (!peer) return new Response(null, { status: 401 });
      const repository = peer.repository(request.signal);
      const operation = address.pathname.split("/").pop();
      if (operation === "chunk") {
        const metadata = record(JSON.parse(str(request.headers.get("x-runner-command"))));
        const job = decodeJob(str(metadata.job), peer.scope),
          bytes = await readBounded(request, 65536);
        const channel = str(metadata.channel),
          field = str(metadata.field);
        await repository.writeCompletionChunk(job, {
          channel,
          field,
          ordinal: metadata.ordinal,
          chunkOrdinal: metadata.chunkOrdinal,
          bytes,
        } as CompletionFieldChunk);
        return Response.json({ ok: true });
      }
      if (operation === "save") {
        const job = decodeJob(str(request.headers.get("x-runner-job")), peer.scope);
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(
          await readBounded(request, 8 * 1024 * 1024 + 65536),
        );
        await repository.saveCheckpoint(job, decodeCheckpointCase(raw));
        return Response.json({ ok: true });
      }
      const body = record(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(request, 65536)),
        ),
      );
      const job = () => decodeJob(str(body.job), peer!.scope);
      const fence = (): AttemptFence | null =>
        body.attemptId === null
          ? null
          : { attemptId: str(body.attemptId), sandboxScope: peer!.scope };
      switch (operation) {
        case "manifest":
          return Response.json(await repository.inputManifest(job()));
        case "caseref":
          return Response.json(await repository.inputCaseRef(job(), Number(body.ordinal)));
        case "input": {
          const page = await repository.inputPage(
            job(),
            str(body.kind) as InputKind,
            Number(body.ordinal),
            Number(body.offset),
          );
          return new Response(new Uint8Array(page.bytes), {
            headers: {
              "content-type": "application/octet-stream",
              "x-input-hash": page.hash,
              "x-input-size": String(page.size),
              "x-input-channel": page.channel ?? "none",
            },
          });
        }
        case "state":
          return Response.json(await repository.queueState());
        case "empty":
          return Response.json(await repository.confirmQueueEmpty());
        case "deadline":
          return Response.json(await repository.nextRunnableDeadline(peer.scope));
        case "expired":
          return Response.json(await repository.nextExpiredAttempt(peer.resumable, peer.scope));
        case "claim": {
          const value = await repository.claimAfterTeardown(peer.resumable, peer.scope, fence());
          return Response.json(value ? encodeJob(value) : null);
        }
        case "lease":
          return Response.json(await repository.lease(job(), body.heartbeat === true));
        case "load":
          return Response.json(await repository.load(job()));
        case "begin":
          await repository.beginCompletion(
            job(),
            record(body.header) as unknown as CompletionHeader,
          );
          break;
        case "seal":
          await repository.sealCompletionFrame(
            job(),
            str(body.channel) as "public" | "sample" | "private",
            Number(body.ordinal),
            str(body.status),
          );
          break;
        case "diagnostics":
          await repository.sealCompletionDiagnostics(job());
          break;
        case "eof":
          await repository.finishCompletionStream(job(), fence()!);
          break;
        case "promote":
          await repository.promoteCompletion(job(), fence()!);
          break;
        case "checkpoint": {
          const c = await repository.loadCheckpoint(job());
          return Response.json({ ...c, compilationNanos: c.compilationNanos.toString() });
        }
        case "replay": {
          const stream = new TransformStream<Uint8Array, Uint8Array>();
          const writer = stream.writable.getWriter();
          const abort = new AbortController();
          request.signal.addEventListener("abort", () => abort.abort(), { once: true });
          void repository
            .replayCheckpoint(
              job(),
              Number(body.count),
              async (ordinal, frame) => {
                const header = new Uint8Array(8),
                  view = new DataView(header.buffer);
                view.setUint32(0, ordinal);
                view.setUint32(4, frame.length);
                await writer.write(header);
                await writer.write(frame);
              },
              abort.signal,
            )
            .then(
              () => writer.close(),
              (error) => writer.abort(error),
            )
            .catch(() => {});
          return new Response(stream.readable, {
            headers: { "content-type": "application/octet-stream" },
          });
        }
        case "yield":
          await repository.yield(job(), fence()!);
          break;
        default:
          return new Response(null, { status: 404 });
      }
      return Response.json({ ok: true });
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}
