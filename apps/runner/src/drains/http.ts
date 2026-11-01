/** @file http.ts @description Authenticated bounded drain request handling. @module runner */
import { timingSafeEqual, createHash } from "node:crypto";
import { UnconfirmedTeardown } from "../sandbox/types.ts";
import { RunnerCommandError } from "../queue/http.ts";
import type { Drainer } from "./drain.ts";

/** A 202 requires the caller to persist a continuation before acknowledging its wake. */
export function drainHandler(options: {
  drainer: Drainer;
  secret: string;
  timeoutMs?: number;
  background?: {
    signal: AbortSignal;
    state(signal: AbortSignal): Promise<{ queued: number; running: number }>;
  };
}) {
  const secret = new TextEncoder().encode(`Bearer ${options.secret}`);
  if (new TextEncoder().encode(options.secret).length < 32 || /\s/.test(options.secret))
    throw new Error("Invalid drain credential");
  let active = false;
  let pending: Promise<void> = Promise.resolve();
  let previous: Awaited<ReturnType<Drainer["drain"]>> | undefined;
  let failure: unknown;
  const handle = async (request: Request): Promise<Response> => {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return new Response(null, { status: 200 });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/drain")
      return new Response(null, { status: 404 });
    const supplied = new TextEncoder().encode(request.headers.get("authorization") ?? "");
    if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
      return new Response(null, { status: 401 });
    const headers = { "cache-control": "no-store", "content-type": "application/json" };
    if (options.background) {
      const state = await options.background.state(request.signal).catch((error) => {
        failure = error;
        return undefined;
      });
      if (
        state &&
        !failure &&
        !active &&
        previous?.complete &&
        state.queued === 0 &&
        state.running === 0
      )
        return new Response(JSON.stringify(state), { status: 200, headers });
      if (state && !active && !failure) {
        options.drainer.refresh();
        active = true;
        // Request cancellation must not kill a fenced attempt owned by this process.
        const signal = AbortSignal.any([
          options.background.signal,
          AbortSignal.timeout(options.timeoutMs ?? 660000),
        ]);
        pending = Promise.resolve()
          .then(() => options.drainer.drain(signal))
          .then(
            (result) => {
              previous = result;
            },
            (error) => {
              failure = error;
            },
          )
          .finally(() => {
            active = false;
          });
      }
      if (!failure) return new Response(JSON.stringify(state), { status: 202, headers });
    }
    if (!options.background) options.drainer.refresh();
    if (active)
      return new Response(JSON.stringify({ queued: 0, running: 0 }), { status: 202, headers });
    active = true;
    try {
      if (failure) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      const timeout = options.timeoutMs ?? 210000;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
      const state = await options.drainer.drain(signal);
      return new Response(JSON.stringify({ queued: state.queued, running: state.running }), {
        status: state.complete ? 200 : 202,
        headers,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "unavailable",
          failure: {
            kind:
              error instanceof RunnerCommandError
                ? "command"
                : error instanceof UnconfirmedTeardown
                  ? "teardown"
                  : "other",
            fingerprint: createHash("sha256")
              .update(error instanceof Error ? error.message : "unknown")
              .digest("hex"),
            ...(error instanceof UnconfirmedTeardown ? { teardown: error.diagnostic } : {}),
          },
          ...(error instanceof RunnerCommandError && error.diagnostic
            ? { command: error.diagnostic }
            : {}),
        }),
        { status: 503, headers },
      );
    } finally {
      active = false;
    }
  };
  return Object.assign(handle, { settled: () => pending });
}
