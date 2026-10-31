/** @file http.ts @description Private authenticated Node result verification endpoint. @module runner */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VerificationReceipt } from "@quorem/execution";

/** The listener is private; its dedicated secret is distinct from runner command credentials. */
export function verificationHandler(options: {
  credential: Uint8Array;
  verify: (
    challenge: string,
    signal: AbortSignal,
  ) => Promise<{ receipt: VerificationReceipt; signature: Uint8Array }>;
  timeoutMs: number;
}) {
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
    request.once("aborted", () => abort.abort());
    try {
      let body = "";
      for await (const chunk of request) {
        body += (chunk as Buffer).toString("utf8");
        if (body.length > 256) throw new Error("Invalid request");
      }
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
      abort.signal.throwIfAborted();
      const result = await Promise.race([
        options.verify(data.challenge, abort.signal),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener("abort", () => reject(new Error("Verification timeout")), {
            once: true,
          }),
        ),
      ]);
      abort.signal.throwIfAborted();
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(
          JSON.stringify({
            receipt: result.receipt,
            signature: Buffer.from(result.signature).toString("base64"),
          }),
        );
    } catch {
      if (!response.headersSent) response.writeHead(503).end();
    } finally {
      clearTimeout(timer);
    }
  };
}
