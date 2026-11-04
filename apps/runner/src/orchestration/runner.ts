/** @file runner.ts @description Composition of private commands, engine and HTTP drains. @module runner */
import { UnconfirmedTeardown, type IsolatedSandbox } from "../sandbox/types.ts";
import { privateRunnerCommands } from "../queue/http.ts";
import { drainer } from "../drains/drain.ts";
import { drainHandler } from "../drains/http.ts";
import type { AttemptEngine } from "./attempt.ts";
import type { ExecutionRepository, ExecutionInputReader } from "@quorem/execution";
import { controlPolling, queueControl } from "./control.ts";

/** The sandbox and all credentials must be selected explicitly by the trusted host. */
export function createRunner(options: {
  sandbox: IsolatedSandbox & { scope: string };
  commandOrigin: string;
  commandSecret: string;
  drainSecret: string;
  slots: number;
  resumable: boolean;
  commandTimeoutMs: number;
  attemptMs?: number;
  engine: (
    repository: ExecutionRepository & ExecutionInputReader,
    sandbox: IsolatedSandbox,
  ) => AttemptEngine & { readonly inputProtocol: "manifest-v1" };
  fetch?: typeof fetch;
}) {
  if (!options.resumable) throw new Error("Checkpoint capability required");
  if (typeof options.engine !== "function") throw new Error("Manifest-capable engine required");
  const repository = privateRunnerCommands({
    origin: options.commandOrigin,
    secret: options.commandSecret,
    scope: options.sandbox.scope,
    resumable: options.resumable,
    timeoutMs: options.commandTimeoutMs,
    fetch: options.fetch,
  });
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
