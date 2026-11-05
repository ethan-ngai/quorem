/** Execute a release-gated drain using the API's PostgreSQL repository. */
import { createRepositoryRunner } from "../../../../runner/src/orchestration/runner.ts";
import { checkpointedEngine } from "../../../../runner/src/orchestration/engine.ts";
import { remoteSandbox } from "../../../../runner/src/sandbox/remote.ts";
import type { PrivateConfig } from "./private.ts";
import type { RunnerPeer } from "../../adapters/postgres/judging/worker/http.ts";

export function localJudgingDrain(
  peer: PrivateConfig["runnerPeers"][number],
  onUpdate: (terminal: boolean) => Promise<void>,
): RunnerPeer["drain"] {
  return async (request, config, repository) => {
    const { origin, secret, namespaceId, ownerPublicKey } = config;
    if (
      typeof origin !== "string" ||
      typeof secret !== "string" ||
      typeof namespaceId !== "string" ||
      typeof ownerPublicKey !== "string"
    )
      return new Response(null, { status: 400 });
    const sandbox = remoteSandbox({
      origin,
      secret,
      namespaceId,
      ownerPublicKey,
      cleanupMs: 30000,
    });
    if (sandbox.scope !== peer.scope) return new Response(null, { status: 403 });
    const finalize = repository.finalizeCompletion;
    if (!finalize) throw new Error("Transactional finalization required");
    const runner = createRepositoryRunner(
      {
        sandbox,
        drainSecret: peer.secret,
        slots: 1,
        graceMs: 1,
        resumable: peer.resumable,
        engine: (commands, isolated) => ({
          ...checkpointedEngine(commands, isolated),
          inputProtocol: "manifest-v1",
        }),
      },
      {
        ...repository,
        async claimAfterTeardown(...args) {
          const job = await repository.claimAfterTeardown(...args);
          if (job) await onUpdate(false);
          return job;
        },
        async yield(...args) {
          await repository.yield(...args);
          await onUpdate(false);
        },
        async promoteCompletion(...args) {
          await repository.promoteCompletion(...args);
          await onUpdate(true);
        },
        async finalizeCompletion(...args) {
          await finalize(...args);
          await onUpdate(true);
        },
      },
    );
    return runner.handler(
      new Request(new URL("/internal/drain", request.url), {
        method: "POST",
        headers: { authorization: request.headers.get("authorization") ?? "" },
        signal: request.signal,
      }),
    );
  };
}
