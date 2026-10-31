/** @file source-http.ts @description Private verifier access to fenced API pages. @module runner */
import { encodeJob, type ExecutionInputReader, type InputPage } from "@quorem/execution";
import type { FrozenCase, VerificationSource } from "./verifier.ts";
/** Every request is bound to one API-created challenge and uses a purpose-specific credential. */
export function httpVerificationSource(options: {
  origin: string;
  credential: Uint8Array;
  challenge: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}): VerificationSource {
  const origin = new URL(options.origin);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      )) ||
    options.credential.length !== 32 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1
  )
    throw new Error("Invalid verification source configuration");
  const secret = Buffer.from(options.credential).toString("hex"),
    send = options.fetch ?? fetch;
  async function call(
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)])
      : AbortSignal.timeout(options.timeoutMs);
    const response = await send(new URL(`/internal/verification/${path}`, origin), {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ challenge: options.challenge, ...payload }),
      signal: combined,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Verification source unavailable");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 100000) {
          await reader.cancel();
          throw new Error("Invalid verification response");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  }
  function page(value: unknown): InputPage {
    if (
      !value ||
      typeof value !== "object" ||
      !("bytes" in value) ||
      typeof value.bytes !== "string" ||
      value.bytes.length > 87384 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bytes)
    )
      throw new Error("Invalid verification page");
    const result = value as Record<string, unknown>;
    return { ...result, bytes: Buffer.from(value.bytes, "base64") } as unknown as InputPage;
  }
  const inputs: ExecutionInputReader = {
    async inputManifest(job, signal) {
      encodeJob(job);
      return (await call("manifest", {}, signal)) as Awaited<
        ReturnType<ExecutionInputReader["inputManifest"]>
      >;
    },
    async inputCaseRef(job, _ordinal, signal) {
      encodeJob(job);
      return (await call("ref", {}, signal)) as Awaited<
        ReturnType<ExecutionInputReader["inputCaseRef"]>
      >;
    },
    async inputPage(job, kind, _ordinal, offset, signal) {
      encodeJob(job);
      if (kind !== "case" && kind !== "metadata") throw new Error("Invalid verification input");
      return page(await call("page", { kind, offset }, signal));
    },
  };
  return {
    inputs,
    async frozenCase(challenge, signal) {
      if (challenge !== options.challenge) throw new Error("Invalid challenge");
      return (await call("frozen", {}, signal)) as FrozenCase;
    },
    async fieldPage(challenge, field, offset, signal) {
      if (challenge !== options.challenge) throw new Error("Invalid challenge");
      return page(await call("field", { field, offset }, signal));
    },
    async putField(challenge, field, bytes, signal) {
      if (challenge !== options.challenge) throw new Error("Invalid challenge");
      let ordinal = 0;
      for await (const chunk of bytes)
        await call(
          "output",
          { field, ordinal: ordinal++, bytes: Buffer.from(chunk).toString("base64") },
          signal,
        );
    },
  };
}
