/** @file verification-client.ts @description Private independent result verification transport. @module judging */
import { verificationReceiptBytes, type VerificationReceipt } from "@quorem/execution";
export interface ResultVerifier {
  verify(
    challenge: string,
    signal?: AbortSignal,
  ): Promise<{ receipt: VerificationReceipt; signature: Uint8Array }>;
}
/** HTTPS is mandatory outside loopback; redirects and oversized responses fail closed. */
export function httpResultVerifier(options: {
  origin: string;
  credential: Uint8Array;
  timeoutMs: number;
  fetch?: typeof fetch;
}): ResultVerifier {
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
    throw new Error("Invalid verifier configuration");
  const token = Array.from(options.credential, (x) => x.toString(16).padStart(2, "0")).join(""),
    send = options.fetch ?? fetch;
  return {
    async verify(challenge, signal) {
      const combined = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)])
        : AbortSignal.timeout(options.timeoutMs);
      const response = await send(new URL("/internal/results/verify", origin), {
        method: "POST",
        redirect: "manual",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ challenge }),
        signal: combined,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("Verifier unavailable");
      }
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 16384) {
            await reader.cancel();
            throw new Error("Invalid verifier response");
          }
          parts.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let pos = 0;
      for (const part of parts) {
        bytes.set(part, pos);
        pos += part.length;
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        !value ||
        typeof value !== "object" ||
        !("receipt" in value) ||
        !("signature" in value) ||
        typeof value.signature !== "string" ||
        !/^[A-Za-z0-9+/]{86}==$/.test(value.signature)
      )
        throw new Error("Invalid verifier response");
      const receipt = value.receipt as VerificationReceipt;
      verificationReceiptBytes(receipt);
      const raw = atob(value.signature),
        signature = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      return { receipt, signature };
    },
  };
}
