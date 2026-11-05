/** Execute a release-gated drain using the API's PostgreSQL repository. */
import { judgingCapacity } from "@quorem/execution";
import { createRepositoryRunner } from "../../../../runner/src/orchestration/runner.ts";
import { checkpointedEngine } from "../../../../runner/src/orchestration/engine.ts";
import { remoteSandbox } from "../../../../runner/src/sandbox/remote.ts";
import type { PrivateConfig } from "./private.ts";
import type { RunnerPeer } from "../../adapters/postgres/judging/worker/http.ts";
import { judgingProfile } from "./judging-profile.ts";

export function localJudgingDrain(
  peer: PrivateConfig["runnerPeers"][number],
  onUpdate: (terminal: boolean) => Promise<void>,
  capacity = judgingCapacity({}),
  measurement?: ReturnType<typeof judgingProfile>,
): RunnerPeer["drain"] {
  return async (request, config, repository) => {
    const profile = measurement ?? judgingProfile();
    repository = profile.wrap(repository, "repository");
    const { origin, secret, namespaceId, ownerPublicKey } = config;
    if (
      typeof origin !== "string" ||
      typeof secret !== "string" ||
      typeof namespaceId !== "string" ||
      typeof ownerPublicKey !== "string"
    )
      return new Response(null, { status: 400 });
    const sandbox = profile.wrap(
      remoteSandbox({
        origin,
        secret,
        namespaceId,
        ownerPublicKey,
        cleanupMs: 30000,
        fetch: profile.wrap(
          {
            async headers(input: RequestInfo | URL, init?: RequestInit) {
              const sent = Date.now();
              const response = await fetch(input, init);
              const received = Number(response.headers.get("x-quorem-case-received-at"));
              const admitted = Number(response.headers.get("x-quorem-case-admitted-at"));
              if (
                received > 0 &&
                admitted > 0 &&
                Number.isSafeInteger(received) &&
                Number.isSafeInteger(admitted)
              ) {
                profile.record("case.dispatch", received - sent);
                profile.record("case.admission", admitted - received);
                profile.record("case.headersTransit", Date.now() - admitted);
              }
              return response;
            },
          },
          "case",
        ).headers,
      }),
      "sandbox",
    );
    if (sandbox.scope !== peer.scope) return new Response(null, { status: 403 });
    const finalize = repository.finalizeCompletion?.bind(repository);
    if (!finalize) throw new Error("Transactional finalization required");
    const runner = createRepositoryRunner(
      {
        sandbox,
        drainSecret: peer.secret,
        slots: capacity.slots,
        graceMs: 1,
        resumable: peer.resumable,
        engine: (commands, isolated) => ({
          ...checkpointedEngine(
            commands,
            isolated,
            capacity.sliceMs,
            capacity.caseLanes,
            async () => (await commands.queueState()).queued > 0,
          ),
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
    const response = await runner.handler(
      new Request(new URL("/internal/drain", request.url), {
        method: "POST",
        headers: { authorization: request.headers.get("authorization") ?? "" },
        signal: request.signal,
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("x-quorem-judging-profile", profile.header());
    return new Response(response.body, { status: response.status, headers });
  };
}
