import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { startBrowserFixture } from "../apps/api/src/runtime/composition/browser-fixture.ts";
import {
  acceptedSource,
  version,
} from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";
import { runStageWorkload } from "./hono-stage-workload.mjs";

void test(
  "real loopback HTTP, socket, runner and verifier workload",
  { timeout: 240000 },
  async () => {
    const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
    if (!socket || !socket.startsWith("/")) throw new Error("Owned Docker socket required");
    await withDisposablePostgres(
      { prefix: "quorem-workload", port: 55701, database: "quorem_hono_runtime_test" },
      async ({ url }) => {
        const fixture = await startBrowserFixture(url, socket);
        try {
          const RealSocket = createRequire(new URL("../apps/api/package.json", import.meta.url))(
            "ws",
          );
          class LoopbackSocket extends RealSocket {
            constructor(url, protocols, options) {
              super(
                url.replace(
                  "wss://api-stage.example.com",
                  fixture.apiOrigin.replace("http:", "ws:"),
                ),
                protocols,
                { ...options, origin: fixture.webOrigin },
              );
            }
          }
          const tokens = [fixture.bearers.alice, fixture.bearers.bob];
          const result = await runStageWorkload(
            {
              HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
              HONO_STAGE_BROWSER_ORIGIN: "https://web-stage.example.com",
              ALLOWED_ORIGINS: "https://web-stage.example.com",
            },
            {
              matchCount: 1,
              WebSocket: LoopbackSocket,
              createActor: async () => ({
                sessionCookie: tokens.shift(),
                problemVersionId: version,
                acceptedSource,
                dispose: async () => {},
              }),
              fetch: async (url, init) => {
                if (url.endsWith("/api/auth/token"))
                  return Response.json({ token: init.headers.cookie });
                const headers = new Headers(init.headers);
                headers.set("origin", fixture.webOrigin);
                return fetch(url.replace("https://api-stage.example.com", fixture.apiOrigin), {
                  ...init,
                  headers,
                });
              },
            },
          );
          assert.equal(result.profile, "fixture");
          assert.equal(result.sessions, 2);
          assert.equal(result.jobs.count, 2);
          assert.equal(result.errors, 0);
        } finally {
          await fixture.close();
        }
      },
    );
  },
);
