/** @file server.ts @description Private HTTP listener with bounded graceful shutdown. @module runner */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { normalizeHttpTarget } from "@quorem/execution/transport/http-target";

export async function listenPrivate(
  address: { host: string; port: number },
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
) {
  const active = new Set<Promise<void>>();
  let closing = false;
  const server = createServer((request, response) => {
    try {
      request.url = normalizeHttpTarget(request.url);
    } catch {
      response.writeHead(400).end();
      return;
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
