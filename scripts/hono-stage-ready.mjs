/** Retry only transient namespace transport/ingress failures, never proof validation. */
import { stageNamespace } from "./hono-stage-deploy-proof.mjs";
import { probeNamespace } from "../deploy/hono/services/probe.mjs";

export async function stageNamespaceReady(env, pinned, options = {}) {
  const {
    send = fetch,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 120000,
    intervalMs = 2000,
  } = options;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1 ||
    intervalMs > timeoutMs
  )
    throw new Error("Invalid stage readiness deadline");
  const deadline = now() + timeoutMs,
    transient = Symbol("transient ingress");
  return stageNamespace(env, pinned, async (input) => {
    for (;;) {
      try {
        return await probeNamespace(input, async (url, init) => {
          if (
            (init?.method ?? "GET") !== "GET" ||
            new URL(url).pathname !== "/internal/case/namespace"
          )
            throw new Error("Invalid readiness request");
          let response;
          try {
            response = await send(url, init);
          } catch {
            throw transient;
          }
          if ([401, 403, 404, 409, 429].includes(response.status) || response.status >= 500) {
            void response.body?.cancel().catch(() => {});
            throw transient;
          }
          return response;
        });
      } catch (error) {
        if (error !== transient) throw error;
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error("Stage namespace readiness timed out");
        await sleep(Math.min(intervalMs, remaining));
        if (now() >= deadline) throw new Error("Stage namespace readiness timed out");
      }
    }
  });
}
