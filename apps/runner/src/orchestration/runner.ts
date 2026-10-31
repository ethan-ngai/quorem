/** @file runner.ts @description Composition of private commands, engine and HTTP drains. @module runner */
import type { IsolatedSandbox } from "../sandbox/types.ts";
import { privateRunnerCommands } from "../queue/http.ts";
import { drainer } from "../drains/drain.ts";
import { drainHandler } from "../drains/http.ts";
import { checkpointedEngine } from "./engine.ts";
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
  fetch?: typeof fetch;
}) {
  if (!options.resumable) throw new Error("Checkpoint capability required");
  const repository = privateRunnerCommands({
    origin: options.commandOrigin,
    secret: options.commandSecret,
    scope: options.sandbox.scope,
    resumable: options.resumable,
    timeoutMs: options.commandTimeoutMs,
    fetch: options.fetch,
  });
  const drain = drainer({
    repository,
    sandbox: options.sandbox,
    cancellations: controlPolling(),
    queue: queueControl(repository, options.sandbox.scope),
    engine: checkpointedEngine(repository, options.sandbox),
    slots: options.slots,
    resumable: options.resumable,
  });
  return { drain, handler: drainHandler({ drainer: drain, secret: options.drainSecret }) };
}
