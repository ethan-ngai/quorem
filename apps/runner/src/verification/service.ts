/** @file service.ts @description Compose the trusted private result verifier. @module runner */
import { verificationHandler } from "./http.ts";
import { httpVerificationSource } from "./source-http.ts";
import { nodeResultVerifier } from "./verifier.ts";
/** The listener is provisioned privately; all credentials are separate from sandbox execution. */
export function createVerificationService(options: {
  sourceOrigin: string;
  sourceCredential: Uint8Array;
  serviceCredential: Uint8Array;
  signingKey: CryptoKey;
  timeoutMs: number;
  fetch?: typeof fetch;
}) {
  if (
    options.sourceCredential.length !== 32 ||
    options.serviceCredential.length !== 32 ||
    options.sourceCredential.every((value, index) => value === options.serviceCredential[index])
  )
    throw new Error("Distinct verification credentials required");
  return verificationHandler({
    credential: options.serviceCredential,
    timeoutMs: options.timeoutMs,
    async verify(challenge, signal) {
      const source = httpVerificationSource({
        origin: options.sourceOrigin,
        credential: options.sourceCredential,
        challenge,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      });
      return nodeResultVerifier(source, options.signingKey)(challenge, signal);
    },
  });
}
