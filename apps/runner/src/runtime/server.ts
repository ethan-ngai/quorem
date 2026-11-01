/** @file server.ts @description Private HTTP listener with bounded graceful shutdown. @module runner */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

export async function listenPrivate(
  address: { host: string; port: number },
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
) {
  const active = new Set<Promise<void>>();
  let closing = false;
  const server = createServer((request, response) => {
    // Container proxies may use the RFC absolute-form request target.
    if (/^https?:\/\//i.test(request.url ?? "")) {
      try {
        const target = new URL(request.url!);
        if (target.username || target.password) throw new Error("Invalid request target");
        request.url = target.pathname + target.search;
      } catch {
        response.writeHead(400).end();
        return;
      }
    }
    if (closing) {
      response.writeHead(503).end();
      return;
    }
    const task = handle(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) response.writeHead(503).end();
      else response.destroy();
    });
    active.add(task);
    void task.finally(() => active.delete(task));
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(address.port, address.host);
  await once(server, "listening");
  return {
    async close() {
      closing = true;
      const stopped = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      await Promise.all(active);
      await stopped;
    },
  };
}
