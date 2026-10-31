import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import {
  assertBrowserDatabase,
  startBrowserFixture,
  browserViteEnvironment,
} from "./browser-fixture.ts";

void test("browser fixture requires its exact disposable loopback database and port", async () => {
  assert.doesNotThrow(() =>
    assertBrowserDatabase(
      "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test?sslmode=disable",
    ),
  );
  for (const value of [
    "postgres://fixture@127.0.0.1:54329/quorem_hono_runtime_test",
    "postgres://fixture@127.0.0.1:55690/quorem_hono_runtime_test",
    "postgres://fixture@127.0.0.1:55701/quorem",
    "postgres://fixture@localhost:55701/quorem_hono_runtime_test",
    "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test?host=elsewhere",
    "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test?HOSTADDR=10.0.0.1",
    "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test#fragment",
  ])
    assert.throws(() => assertBrowserDatabase(value));
  await assert.rejects(
    startBrowserFixture(
      "postgres://fixture@127.0.0.1:54329/quorem_hono_runtime_test",
      "/var/run/docker.sock",
    ),
  );
});

void test(
  "the fixture's live Vite response includes the React refresh preamble",
  { timeout: 30000 },
  async () => {
    const child = spawn("vp", ["-C", "apps/web", "dev", "--port", "5188"], {
      cwd: resolve(import.meta.dirname, "../../../../.."),
      env: browserViteEnvironment({ ...process.env, NODE_ENV: "production" }),
      stdio: "ignore",
      detached: true,
    });
    try {
      let html = "";
      for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) break;
        try {
          const response = await fetch("http://127.0.0.1:5188/practice", {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            html = await response.text();
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(html, /\/@react-refresh/);
      assert.match(html, /window\.\$RefreshReg\$/);
      assert.match(html, /\/@vite\/client/);
      const module = await (await fetch("http://127.0.0.1:5188/src/ui/LoadingScreen.tsx")).text();
      assert.match(module, /\$RefreshReg\$/);
    } finally {
      if (child.pid && child.exitCode === null) {
        process.kill(-child.pid, "SIGTERM");
        await once(child, "exit");
      }
    }
  },
);
