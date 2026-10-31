/** @file http.ts @description Authenticated bounded drain request handling. @module runner */
import { timingSafeEqual } from "node:crypto";
import type { Drainer } from "./drain.ts";

/** A 202 requires the caller to persist a continuation before acknowledging its wake. */
export function drainHandler(options: { drainer: Drainer; secret: string; timeoutMs?: number }) {
  const secret = new TextEncoder().encode(`Bearer ${options.secret}`);
  if (new TextEncoder().encode(options.secret).length < 32 || /\s/.test(options.secret))
    throw new Error("Invalid drain credential");
  let active = false;
  return async (request: Request): Promise<Response> => {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return new Response(null, { status: 200 });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/drain")
      return new Response(null, { status: 404 });
    const supplied = new TextEncoder().encode(request.headers.get("authorization") ?? "");
    if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
      return new Response(null, { status: 401 });
    options.drainer.refresh();
    const headers = { "cache-control": "no-store", "content-type": "application/json" };
    if (active)
      return new Response(JSON.stringify({ queued: 0, running: 0 }), { status: 202, headers });
    active = true;
    try {
      const timeout = options.timeoutMs ?? 210000;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
      const state = await options.drainer.drain(signal);
      return new Response(JSON.stringify({ queued: state.queued, running: state.running }), {
        status: state.complete ? 200 : 202,
        headers,
      });
    } catch {
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers });
    } finally {
      active = false;
    }
  };
}
