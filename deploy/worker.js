/** @file worker.js @description Same-origin entrypoint for the production container. @module deployment */
import { DurableObject } from "cloudflare:workers";

export class Quorem extends DurableObject {
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) return new Response("Service unavailable", { status: 503 });
    if (!container.running)
      container.start({ enableInternet: true, env: JSON.parse(this.env.RUNTIME_ENV) });
    await container.setInactivityTimeout(10 * 60 * 1000);
    if (!this.monitoring) {
      this.monitoring = true;
      this.stopped = false;
      this.ctx.waitUntil(
        container
          .monitor()
          .catch((error) => {
            console.error("Container stopped", {
              message: error.message,
              exitCode: error.exitCode,
            });
          })
          .finally(() => {
            this.stopped = true;
            this.monitoring = false;
          }),
      );
    }
    const port = container.getTcpPort(8088);
    // Only readiness probes retry; replaying a command could duplicate its effects.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !this.stopped) {
      try {
        const health = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(2000),
        });
        const ready = health.ok;
        await health.body?.cancel();
        if (ready) {
          const url = new URL(request.url);
          url.protocol = "http:";
          url.host = "container";
          const forwarded = new Request(url, request);
          forwarded.headers.delete("host");
          return port.fetch(forwarded);
        }
      } catch {
        /* The process may still be starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return new Response("Service starting", { status: 503, headers: { "Retry-After": "5" } });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN) return new Response("Unknown host", { status: 421 });
    if (url.pathname === "/internal" || url.pathname.startsWith("/internal/"))
      return new Response(null, { status: 404 });
    return env.QUOREM.getByName("primary").fetch(request);
  },
};
