/** @file runner.ts @description Private runner process and bounded recovery loop. @module runner */
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dockerSandbox } from "../sandbox/docker.ts";
import { remoteSandbox } from "../sandbox/remote.ts";
import { checkpointedEngine } from "../orchestration/engine.ts";
import { drainHandler } from "../drains/http.ts";
import { UnconfirmedTeardown } from "../sandbox/types.ts";
import { createRunner } from "../orchestration/runner.ts";
import { runnerConfig } from "./config.ts";
import { accessFetch } from "@quorem/execution/transport/access";
import { listenPrivate } from "./server.ts";

export async function startRunner(env: NodeJS.ProcessEnv) {
  const config = runnerConfig(env);
  const sandbox =
    config.sandbox.provider === "docker"
      ? await dockerSandbox({ ...config.sandbox, cleanupMs: config.cleanupMs })
      : remoteSandbox({
          ...config.sandbox,
          ownerPublicKey: await readFile(config.sandbox.publicKeyFile, "utf8"),
          fetch: accessFetch(config.sandbox.origin, config.sandbox.access),
          cleanupMs: config.cleanupMs,
        });
  const runner = createRunner({
    sandbox,
    commandOrigin: config.commandOrigin,
    commandSecret: config.commandSecret,
    drainSecret: config.drainSecret,
    slots: config.slots,
    resumable: true,
    commandTimeoutMs: config.commandTimeoutMs,
    fetch: accessFetch(config.commandOrigin, config.access),
    engine: (repository, isolated) => ({
      ...checkpointedEngine(repository, isolated, config.sliceMs),
      inputProtocol: "manifest-v1",
    }),
  });
  let teardownFailure: UnconfirmedTeardown | undefined;
  const supervised = {
    refresh: () => runner.drain.refresh(),
    async drain(signal: AbortSignal) {
      if (teardownFailure) throw teardownFailure;
      try {
        return await runner.drain.drain(signal);
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
  const handleDrain = drainHandler({ drainer: supervised, secret: config.drainSecret });
  const shutdown = new AbortController();
  const server = await listenPrivate(config.listen, async (incoming, outgoing) => {
    if (teardownFailure) {
      outgoing.writeHead(503).end();
      return;
    }
    if (
      incoming.method === "POST" &&
      (incoming.headers["transfer-encoding"] ||
        Number(incoming.headers["content-length"] ?? 0) !== 0)
    ) {
      outgoing.writeHead(400).end();
      return;
    }
    if (config.mode === "continuous" && incoming.method === "POST") {
      outgoing.writeHead(409).end();
      return;
    }
    const cancelled = new AbortController();
    incoming.once("aborted", () => cancelled.abort());
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) cancelled.abort();
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      for (const part of Array.isArray(value) ? value : value === undefined ? [] : [value])
        headers.append(name, part);
    }
    const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
      method: incoming.method,
      headers,
      signal: AbortSignal.any([shutdown.signal, cancelled.signal]),
    });
    const response = await handleDrain(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  // Database queue reads are authoritative; polling repairs missed wake deliveries.
  const continuous =
    config.mode === "continuous"
      ? (async () => {
          while (!shutdown.signal.aborted) {
            try {
              supervised.refresh();
              await supervised.drain(shutdown.signal);
            } catch {
              if (shutdown.signal.aborted || teardownFailure) break;
            }
            try {
              await sleep(config.pollMs, undefined, { signal: shutdown.signal });
            } catch {
              break;
            }
          }
        })()
      : Promise.resolve();
  return {
    scope: sandbox.scope,
    async close() {
      shutdown.abort();
      await Promise.all([server.close(), continuous]);
      if (teardownFailure) throw teardownFailure;
    },
  };
}
if (import.meta.main) {
  try {
    const service = await startRunner(process.env);
    process.stdout.write(`${JSON.stringify({ scope: service.scope })}\n`);
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void service.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    console.error("Runner startup failed");
    process.exitCode = 1;
  }
}
