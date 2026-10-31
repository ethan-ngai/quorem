/// <reference types="node" />
import { serve } from "@hono/node-server";
import { once } from "node:events";
import { get, type Server } from "node:http";
import { strict as assert } from "node:assert";
import { it } from "vitest";
import { requestBudget } from "./budget.ts";

it("HTTP disconnect cancels the response and releases the permit", async () => {
  const budget = requestBudget(1);
  let cancels = 0;
  let cancelled!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      budget(request, async () => {
        if (new URL(request.url).pathname === "/next") return new Response("ok");
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
            },
            cancel() {
              cancels++;
              cancelled();
            },
          }),
        );
      }),
  }) as Server;
  try {
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve, reject) => {
      const request = get(origin, (response) => {
        response.once("data", () => {
          response.destroy();
          resolve();
        });
        response.once("error", reject);
      });
      request.once("error", reject);
    });
    await cancellation;
    const next = await fetch(`${origin}/next`);
    assert.equal(next.status, 200);
    assert.equal(await next.text(), "ok");
    assert.equal(cancels, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 5000);
