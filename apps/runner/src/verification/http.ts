/** @file http.ts @description Private authenticated result verification transports. @module runner */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VerificationReceipt } from "@quorem/execution";

/** The listener is private; its dedicated secret is distinct from runner command credentials. */
type VerificationOptions = {
  credential: Uint8Array;
  verify: (
    challenge: string,
    signal: AbortSignal,
    inlineFields?: boolean,
  ) => Promise<{
    receipt: VerificationReceipt;
    signature: Uint8Array;
    fields?: readonly { field: "actual" | "expected"; bytes: Uint8Array }[];
  }>;
  timeoutMs: number;
};

function challengeFrom(body: string): string {
  const data: unknown = JSON.parse(body);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length !== 1 ||
    !("challenge" in data) ||
    typeof data.challenge !== "string" ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(data.challenge)
  )
    throw new Error("Invalid request");
  return data.challenge;
}

function verificationJSON(result: Awaited<ReturnType<VerificationOptions["verify"]>>) {
  return {
    receipt: result.receipt,
    signature: Buffer.from(result.signature).toString("base64"),
    fields: result.fields?.map(({ field, bytes }) => ({
      field,
      bytes: Buffer.from(bytes).toString("base64"),
    })),
  };
}

export function verificationHandler(options: VerificationOptions) {
  if (
    options.credential.length !== 32 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1
  )
    throw new Error("Invalid verification service configuration");
  const expected = Buffer.from(options.credential);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const token = request.headers.authorization;
    const presented =
      typeof token === "string" && /^Bearer [0-9a-f]{64}$/.test(token)
        ? Buffer.from(token.slice(7), "hex")
        : Buffer.alloc(0);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      response.writeHead(401).end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/internal/results/verify") {
      response.writeHead(404).end();
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), options.timeoutMs);
    const stopReading = () => {
      if (!request.complete) request.destroy();
    };
    abort.signal.addEventListener("abort", stopReading, { once: true });
    const clientClosed = () => {
      if (!response.writableFinished) abort.abort();
    };
    request.once("aborted", clientClosed);
    response.once("close", clientClosed);
    try {
      let body = "",
        size = 0;
      for await (const chunk of request) {
        size += (chunk as Buffer).length;
        if (size > 256) throw new Error("Invalid request");
        body += (chunk as Buffer).toString("utf8");
      }
      const challenge = challengeFrom(body);
      abort.signal.throwIfAborted();
      const result = await Promise.race([
        options.verify(challenge, abort.signal),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener("abort", () => reject(new Error("Verification timeout")), {
            once: true,
          }),
        ),
      ]);
      abort.signal.throwIfAborted();
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(verificationJSON(result)));
    } catch {
      if (!response.headersSent && !response.destroyed) response.writeHead(503).end();
    } finally {
      clearTimeout(timer);
      request.off("aborted", clientClosed);
      response.off("close", clientClosed);
      abort.signal.removeEventListener("abort", stopReading);
    }
  };
}

export function verificationFetch(options: VerificationOptions) {
  if (
    options.credential.length !== 32 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1
  )
    throw new Error("Invalid verification service configuration");
  const expected = Buffer.from(`Bearer ${Buffer.from(options.credential).toString("hex")}`);
  return async (request: Request): Promise<Response> => {
    const presented = Buffer.from(request.headers.get("authorization") ?? "");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected))
      return new Response(null, { status: 401 });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/results/verify" || url.search)
      return new Response(null, { status: 404 });
    const cancelled = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      cancelled.signal,
      AbortSignal.timeout(options.timeoutMs),
    ]);
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 503 });
    const cancel = () => void reader.cancel().catch(() => {});
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 256) {
          cancel();
          throw new Error("Invalid request");
        }
        parts.push(part.value);
      }
      const challenge = challengeFrom(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
      );
      signal.throwIfAborted();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          let abort!: () => void;
          const expired = new Promise<never>((_, reject) => {
            abort = () => reject(signal.reason);
          });
          signal.addEventListener("abort", abort, { once: true });
          // JSON whitespace releases the pending-header slot before independent verification.
          controller.enqueue(new TextEncoder().encode(" "));
          try {
            signal.throwIfAborted();
            const result = await Promise.race([
              options.verify(
                challenge,
                signal,
                request.headers.get("x-quorem-verification-fields") === "inline",
              ),
              expired,
            ]);
            signal.throwIfAborted();
            controller.enqueue(new TextEncoder().encode(JSON.stringify(verificationJSON(result))));
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            signal.removeEventListener("abort", abort);
          }
        },
        cancel(reason) {
          cancelled.abort(reason);
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch {
      return new Response(null, { status: 503 });
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  };
}
