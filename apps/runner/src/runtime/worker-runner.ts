/** Compose the native Worker drain without the portable Node listener. */
import { checkpointedEngine } from "../orchestration/engine.ts";
import { createRunner } from "../orchestration/runner.ts";
import { remoteSandbox } from "../sandbox/remote.ts";
import { integer, origin } from "./config.ts";

export function workerRunner(env: NodeJS.ProcessEnv, caseFetch: typeof fetch) {
  const sandbox = remoteSandbox({
    origin: origin(env, "QUOREM_CASE_ORIGIN"),
    secret: env.QUOREM_CASE_SECRET ?? "",
    namespaceId: env.QUOREM_CASE_NAMESPACE_ID ?? "",
    ownerPublicKey: env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM ?? "",
    cleanupMs: integer(env, "QUOREM_SANDBOX_CLEANUP_MS", 30000, 120000),
    fetch: caseFetch,
  });
  return createRunner({
    sandbox,
    commandOrigin: origin(env, "QUOREM_RUNNER_COMMAND_ORIGIN"),
    commandSecret: env.QUOREM_RUNNER_COMMAND_SECRET ?? "",
    drainSecret: env.QUOREM_RUNNER_DRAIN_SECRET ?? "",
    slots: 1,
    resumable: true,
    commandTimeoutMs: integer(env, "QUOREM_RUNNER_COMMAND_TIMEOUT_MS", 60000, 120000),
    engine: (repository, isolated) => ({
      ...checkpointedEngine(repository, isolated),
      inputProtocol: "manifest-v1",
    }),
  }).handler;
}
