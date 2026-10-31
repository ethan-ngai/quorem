import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    const cache = await mkdtemp(join(tmpdir(), "quorem-vite-test-"));
    const child = spawn("vp", ["-C", "apps/web", "dev", "--port", "5188"], {
      cwd: resolve(import.meta.dirname, "../../../../.."),
      env: browserViteEnvironment({ ...process.env, NODE_ENV: "production" }, cache),
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
      await rm(cache, { recursive: true, force: true });
    }
  },
);

void test(
  "two Vite servers keep interview and editor dependency caches isolated",
  { timeout: 60000 },
  async () => {
    const caches = await Promise.all(
      [0, 1].map(() => mkdtemp(join(tmpdir(), "quorem-vite-isolated-"))),
    );
    const ports = [5188, 5189];
    const children = ports.map((port, i) =>
      spawn("vp", ["-C", "apps/web", "dev", "--port", String(port)], {
        cwd: resolve(import.meta.dirname, "../../../../.."),
        env: browserViteEnvironment(process.env, caches[i]),
        stdio: "ignore",
        detached: true,
      }),
    );
    try {
      for (const port of ports) {
        let ready = false;
        for (let i = 0; i < 150 && !ready; i++) {
          try {
            ready = (await fetch(`http://127.0.0.1:${port}/interviews`)).ok;
          } catch {}
          if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(ready);
      }
      const files = [
        "/src/features/interviews/InterviewHub.tsx",
        "/src/features/interviews/InterviewPage.tsx",
        "/src/features/editor/PythonEditor.tsx",
      ];
      const graph = async (port: number) => {
        const origin = `http://127.0.0.1:${port}`;
        const pending = [...files],
          seen = new Set<string>();
        while (pending.length && seen.size < 100) {
          const path = pending.shift()!;
          if (seen.has(path)) continue;
          seen.add(path);
          const response = await fetch(origin + path);
          assert.equal(response.status, 200, `${port} ${path}`);
          const source = await response.text();
          for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["'](\/[^"']+)["']/g)) {
            const next = match[1];
            if (next.startsWith("/src/") || (next.startsWith("/@fs/") && next.includes("/deps/")))
              pending.push(next);
          }
        }
        assert.ok(seen.size > files.length);
      };
      await Promise.all(ports.map(graph));
      await Promise.all(ports.map(graph));
    } finally {
      for (const child of children)
        if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
      await Promise.all(
        children.map((child) =>
          child.exitCode === null ? once(child, "exit").catch(() => {}) : Promise.resolve(),
        ),
      );
      await Promise.all(caches.map((cache) => rm(cache, { recursive: true, force: true })));
    }
  },
);
