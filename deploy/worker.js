/** @file worker.js @description Same-origin entrypoint for the production container. @module deployment */
import { DurableObject } from "cloudflare:workers";

export class Quorem extends DurableObject {
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) return new Response("Service unavailable", { status: 503 });
    if (!container.running)
      container.start({ enableInternet: true, env: JSON.parse(this.env.RUNTIME_ENV) });
    const port = container.getTcpPort(8088);
    // Only readiness probes retry; replaying a command could duplicate its effects.
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const health = await port.fetch("http://container/health");
        if (health.ok) return port.fetch(request);
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
