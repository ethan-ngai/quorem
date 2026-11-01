import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";

const remaining = (prefix) =>
  execFileSync("docker", ["ps", "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}"], {
    encoding: "utf8",
  }).trim();
void test(
  "foreign port binding is refused without affecting its listener",
  { timeout: 30000 },
  async () => {
    const prefix = `quorem-bind-${randomUUID()}`,
      listener = createServer();
    listener.listen(55708, "127.0.0.1");
    await once(listener, "listening");
    try {
      await assert.rejects(
        withDisposablePostgres(
          { prefix, port: 55708, database: "quorem_hono_foreign_test", automaticPort: false },
          async () => {
            throw new Error("unexpected");
          },
        ),
      );
      assert.equal(listener.listening, true);
      assert.equal(remaining(prefix), "");
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  void test(
    `${signal} stops the child and confirms owned container removal`,
    { timeout: 30000 },
    async () => {
      const prefix = `quorem-signal-${randomUUID()}`;
      const script = `import {withDisposablePostgres} from './scripts/hono-disposable-postgres.mjs'; await withDisposablePostgres({prefix:${JSON.stringify(prefix)},port:55709,database:'quorem_hono_signal_test'},async ({run})=>{process.stdout.write('READY\\n'); await run(process.execPath,['-e','setInterval(()=>{},1000)']);});`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      try {
        for await (const chunk of child.stdout) {
          output += chunk;
          if (output.includes("READY\n")) {
            child.kill(signal);
            break;
          }
        }
        assert.match(output, /READY/);
        const [code] = await once(child, "exit");
        assert.notEqual(code, 0);
        assert.equal(remaining(prefix), "");
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
  );

void test(
  "automatic fixture binding avoids an occupied requested port",
  { timeout: 30000 },
  async () => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    const prefix = `quorem-auto-${randomUUID()}`;
    try {
      await withDisposablePostgres(
        { prefix, port, database: "quorem_hono_automatic_test", automaticPort: true },
        async ({ url }) => {
          assert.notEqual(Number(new URL(url).port), port);
          const { createRequire } = await import("node:module");
          const { Client } = createRequire(
            new URL("../packages/database/package.json", import.meta.url),
          )("pg");
          const client = new Client({ connectionString: url });
          try {
            await client.connect();
            assert.equal(
              (await client.query("SELECT current_database() AS name")).rows[0].name,
              "quorem_hono_automatic_test",
            );
          } finally {
            await client.end();
          }
        },
      );
      assert.equal(listener.listening, true);
      assert.equal(remaining(prefix), "");
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  },
);
