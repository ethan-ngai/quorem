/** @file lifecycle.test.ts @description Real concurrent document admission and container teardown. @module language */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const execute = promisify(execFile);
const address = "127.0.0.1:8082";

void test(
  "concurrent owner documents stay isolated, bounded and cleaned on SIGTERM",
  {
    skip: process.env.QUOREM_LANGUAGE_TEST !== "true",
    timeout: 45000,
  },
  async () => {
    const service = spawn(process.execPath, ["--experimental-strip-types", "src/main.ts"], {
      env: { ...process.env, LANGUAGE_ADDR: address, QUOREM_DEV_IDENTITY: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    service.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    service.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    const exited = new Promise<number | null>((resolve) => service.once("exit", resolve));
    const clients: WebSocket[] = [];
    const containers = async () =>
      (
        await execute("docker", [
          "ps",
          "-aq",
          "--filter",
          `label=quorem.language.address=${address}`,
        ])
      ).stdout
        .trim()
        .split("\n")
        .filter(Boolean);
    async function until(check: () => Promise<boolean>, message: string): Promise<void> {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (await check()) return;
        assert.equal(service.exitCode, null, output);
        await delay(40);
      }
      assert.fail(message + "\n" + output);
    }
    async function connect(owner: string) {
      const client = new WebSocket(`ws://${address}/lsp?user=${owner}`, {
        origin: "http://localhost:5173",
      });
      clients.push(client);
      const closed = new Promise<number>((resolve) => client.once("close", resolve));
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      return { client, closed };
    }
    try {
      await until(async () => {
        try {
          return (await fetch(`http://${address}/health`)).ok;
        } catch {
          return false;
        }
      }, "Adapter failed to start");
      const first = await connect("alice");
      await until(async () => (await containers()).length === 1, "First container was not created");
      const replacement = await connect("alice");
      await until(async () => (await containers()).length === 2, "Second window engine missing");
      assert.equal(first.client.readyState, WebSocket.OPEN);
      await connect("alice");
      await connect("alice");
      await until(async () => (await containers()).length === 4, "Concurrent engines missing");
      const rejected = await connect("alice");
      assert.equal(await rejected.closed, 1013);
      assert.equal(first.client.readyState, WebSocket.OPEN);
      const initialized = new Promise<void>((resolve) =>
        replacement.client.on("message", (raw) => {
          const message = JSON.parse(
            (Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as Buffer)).toString("utf8"),
          ) as { id?: number; result?: unknown };
          if (message.id === 1 && message.result) resolve();
        }),
      );
      replacement.client.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { processId: null, rootUri: "file:///workspace", capabilities: {} },
        }),
      );
      await initialized;
      replacement.client.close();
      await until(async () => (await containers()).length === 3, "Closed document engine remained");
      const reopened = await connect("alice");
      await until(async () => (await containers()).length === 4, "Reopened engine missing");
      assert.equal(reopened.client.readyState, WebSocket.OPEN);
      const bob = await connect("bob");
      await until(
        async () => (await containers()).length === 5,
        "Independent owner engine missing",
      );
      bob.client.terminate();
      await until(
        async () => (await containers()).length === 4,
        "Abrupt disconnect left an engine",
      );
      const rapid = await connect("bob");
      rapid.client.terminate();
      await until(
        async () => (await containers()).length === 4,
        "Startup disconnect left an engine",
      );
      const started = Date.now();
      service.kill("SIGTERM");
      assert.equal(await exited, 0, output);
      assert.ok(Date.now() - started < 5000, "Shutdown exceeded supervisor deadline");
      assert.deepEqual(await containers(), [], "SIGTERM left language containers");
    } finally {
      for (const client of clients) client.terminate();
      if (service.exitCode === null) service.kill("SIGTERM");
      await exited;
    }
  },
);
