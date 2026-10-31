/** @file private.ts @description Private runner and verification transport composition. @module runtime */
import { accessFetch, type AccessCredentials } from "@quorem/execution/transport/access";
import type { ConnectionScope } from "@quorem/database/core";
import { postgresExecutionCommands } from "../../adapters/postgres/judging/worker/repository.ts";
import { createRunnerCommandHandler } from "../../adapters/postgres/judging/worker/http.ts";
import { createVerificationSourceHandler } from "../../adapters/postgres/judging/worker/verification-http.ts";
import { httpResultVerifier } from "../../adapters/postgres/judging/worker/verification-client.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export interface PrivateConfig {
  runnerPeers: { secret: string; scope: string; resumable: boolean }[];
  verificationSourceCredential: string;
  verificationServiceCredential: string;
  verificationServiceOrigin: string;
  verificationPublicKey: string;
  verificationAccess?: AccessCredentials;
}
function hex(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid private credential");
  return Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
}
/** Distinct credentials prevent runner access to verifier-only material. */
export async function composePrivate(run: Run, config: PrivateConfig) {
  const source = hex(config.verificationSourceCredential),
    service = hex(config.verificationServiceCredential);
  const all = [
    config.verificationSourceCredential,
    config.verificationServiceCredential,
    ...config.runnerPeers.map((p) => p.secret),
  ];
  if (!config.runnerPeers.length || new Set(all).size !== all.length)
    throw new Error("Distinct private credentials required");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(config.verificationPublicKey), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid verification key");
  }
  const key = await crypto.subtle.importKey(
    "spki",
    new Uint8Array(bytes),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const verifier = httpResultVerifier({
    origin: config.verificationServiceOrigin,
    credential: service,
    timeoutMs: 30000,
    fetch: accessFetch(config.verificationServiceOrigin, config.verificationAccess),
  });
  const runner = await createRunnerCommandHandler(
    config.runnerPeers.map((peer) => ({
      ...peer,
      inputProtocol: "manifest-v1" as const,
      repository: (_signal: AbortSignal) =>
        postgresExecutionCommands(
          run,
          {
            inputProtocol: "manifest-v1",
            resumable: peer.resumable,
            losslessCases: true,
            losslessResults: true,
          },
          { verifier, verificationPublicKey: key },
        ),
    })),
  );
  return { runner, source: createVerificationSourceHandler(run, source) };
}
