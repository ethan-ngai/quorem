/** @file runner.ts @description Composition of private commands, engine and HTTP drains. @module runner */
import { UnconfirmedTeardown, type IsolatedSandbox } from "../sandbox/types.ts";
import { privateRunnerCommands } from "../queue/http.ts";
import { drainer } from "../drains/drain.ts";
import { drainHandler } from "../drains/http.ts";
import type { AttemptEngine } from "./attempt.ts";
import type {
  ExecutionRepository,
  ExecutionQueueControl,
  ExecutionInputReader,
} from "@quorem/execution";
import { controlPolling, queueControl } from "./control.ts";

type RunnerOptions = {
  sandbox: IsolatedSandbox & { scope: string };
  drainSecret: string;
  slots: number;
  resumable: boolean;
  attemptMs?: number;
  graceMs?: number;
  singleAttempt?: boolean;
  engine: (
    repository: ExecutionRepository & ExecutionInputReader & ExecutionQueueControl,
    sandbox: IsolatedSandbox,
  ) => AttemptEngine & { readonly inputProtocol: "manifest-v1" };
};

/** The host selects the repository and the sandbox bound to its attempt scope. */
export function createRunner(
  options: RunnerOptions & {
    commandOrigin: string;
    commandSecret: string;
    commandTimeoutMs: number;
    fetch?: typeof fetch;
  },
) {
  if (!options.resumable) throw new Error("Checkpoint capability required");
  if (typeof options.engine !== "function") throw new Error("Manifest-capable engine required");
  return createRepositoryRunner(
    options,
    privateRunnerCommands({
      origin: options.commandOrigin,
      secret: options.commandSecret,
      scope: options.sandbox.scope,
      resumable: options.resumable,
      timeoutMs: options.commandTimeoutMs,
      fetch: options.fetch,
    }),
  );
}

export function createRepositoryRunner(
  options: RunnerOptions,
  repository: ExecutionRepository & ExecutionQueueControl & ExecutionInputReader,
) {
  if (!options.resumable) throw new Error("Checkpoint capability required");
  if (typeof options.engine !== "function") throw new Error("Manifest-capable engine required");
  const engine = options.engine(repository, options.sandbox);
  if (!engine || engine.inputProtocol !== "manifest-v1" || typeof engine.execute !== "function")
    throw new Error("Manifest-capable engine required");
  const inner = drainer({
    repository,
    sandbox: options.sandbox,
    cancellations: controlPolling(),
    queue: queueControl(repository, options.sandbox.scope),
    engine,
    slots: options.slots,
    resumable: options.resumable,
    attemptMs: options.attemptMs,
    graceMs: options.graceMs,
    singleAttempt: options.singleAttempt,
  });
  let teardownFailure: UnconfirmedTeardown | undefined;
  const drain = {
    refresh: () => inner.refresh(),
    async drain(signal: AbortSignal) {
      if (teardownFailure) throw teardownFailure;
      try {
        return await inner.drain(signal);
      } catch (error) {
        if (error instanceof UnconfirmedTeardown) teardownFailure = error;
        console.error(
          JSON.stringify({
            event: "runner-drain-failed",
            kind: error instanceof UnconfirmedTeardown ? "teardown" : "drain",
            ...(error instanceof UnconfirmedTeardown ? { diagnostic: error.diagnostic } : {}),
          }),
        );
        throw error;
      }
    },
  };
  return {
    drain,
    teardownFailure: () => teardownFailure,
    queueState: (signal: AbortSignal) => repository.queueState(signal),
    handler: drainHandler({ drainer: drain, secret: options.drainSecret }),
  };
}
