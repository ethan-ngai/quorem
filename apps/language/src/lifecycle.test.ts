/** @file lifecycle.test.ts @description Real owner admission, takeover and container teardown. @module language */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const execute = promisify(execFile);
const address = "127.0.0.1:18082";

void test(
  "focused-window takeover serializes owner engines and SIGTERM removes them",
  {
    skip: process.env.QUOREM_LANGUAGE_TEST !== "true",
    timeout: 45000,
  },
  async () => {
    const service = spawn(
      process.env.QUOREM_LANGUAGE_GATEWAY_BINARY ?? process.execPath,
      process.env.QUOREM_LANGUAGE_GATEWAY_BINARY
        ? []
        : ["--experimental-strip-types", "src/main.ts"],
      {
        env: {
          ...process.env,
          LANGUAGE_ADDR: address,
          QUOREM_DEV_IDENTITY: "true",
          QUOREM_HOSTED_INTELLIGENCE: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
    async function connect(owner: string, takeover = false) {
      const client = new WebSocket(
        `ws://${address}/lsp?user=${owner}${takeover ? "&takeover=1" : ""}`,
        { origin: "http://localhost:5173" },
      );
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
      const original = (await containers())[0];
      const rejected = await connect("alice");
      assert.equal(await rejected.closed, 4009);
      assert.equal(first.client.readyState, WebSocket.OPEN);
      assert.deepEqual(await containers(), [original]);
      const replacement = await connect("alice", true);
      assert.equal(await first.closed, 4009);
      await until(async () => {
        const ids = await containers();
        assert.ok(ids.length <= 1, "Overlapping owner containers");
        return ids.length === 1 && ids[0] !== original;
      }, "Replacement did not remove the original container");
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
      const priorId = (await containers())[0];
      replacement.client.close();
      const reopened = await connect("alice");
      await until(async () => {
        const ids = await containers();
        assert.ok(ids.length <= 1, "Reopen overlapped the closing container");
        return ids.length === 1 && ids[0] !== priorId;
      }, "Immediate document reopen required takeover");
      assert.equal(reopened.client.readyState, WebSocket.OPEN);
      const bob = await connect("bob");
      await until(
        async () => (await containers()).length === 2,
        "Independent owner container missing",
      );
      bob.client.terminate();
      await until(
        async () => (await containers()).length === 1,
        "Abrupt disconnect left a container",
      );
      const stale = await connect("alice", true);
      const rapid = await connect("alice", true);
      assert.equal(await stale.closed, 4009);
      await until(async () => (await containers()).length === 1, "Latest focused engine missing");
      assert.equal(rapid.client.readyState, WebSocket.OPEN);
      rapid.client.terminate();
      await until(
        async () => (await containers()).length === 0,
        "Disconnect during startup left a container",
      );
      await connect("alice");
      await until(async () => (await containers()).length === 1, "Final session container missing");
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
