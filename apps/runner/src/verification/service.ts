/** @file service.ts @description Compose the trusted private result verifier. @module runner */
import { verificationHandler, verificationFetch } from "./http.ts";
import { httpVerificationSource } from "./source-http.ts";
import { nodeResultVerifier } from "./verifier.ts";
/** The listener is provisioned privately; all credentials are separate from sandbox execution. */
type VerificationConfig = {
  sourceOrigin: string;
  sourceCredential: Uint8Array;
  serviceCredential: Uint8Array;
  signingKey: CryptoKey;
  timeoutMs: number;
  fetch?: typeof fetch;
};

function verificationOptions(options: VerificationConfig) {
  if (
    options.sourceCredential.length !== 32 ||
    options.serviceCredential.length !== 32 ||
    options.sourceCredential.every((value, index) => value === options.serviceCredential[index])
  )
    throw new Error("Distinct verification credentials required");
  // Validate configuration at composition time before opening the private listener.
  nodeResultVerifier(
    httpVerificationSource({
      origin: options.sourceOrigin,
      credential: options.sourceCredential,
      challenge: "configuration",
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    }),
    options.signingKey,
  );
  return {
    credential: options.serviceCredential,
    timeoutMs: options.timeoutMs,
    async verify(challenge: string, signal: AbortSignal) {
      const source = httpVerificationSource({
        origin: options.sourceOrigin,
        credential: options.sourceCredential,
        challenge,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      });
      return nodeResultVerifier(source, options.signingKey)(challenge, signal);
    },
  };
}

export function createVerificationFetch(options: VerificationConfig) {
  return verificationFetch(verificationOptions(options));
}

export function createVerificationService(options: VerificationConfig) {
  return verificationHandler(verificationOptions(options));
}
