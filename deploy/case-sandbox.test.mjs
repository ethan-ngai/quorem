import { test } from "node:test";
import assert from "node:assert/strict";
import { CaseSandbox } from "./case-sandbox.js";

function fixture({ failure = false } = {}) {
  const values = new Map();
  const pending = [];
  let sent = new Uint8Array();
  const context = {
    storage: {
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        values.set(key, value);
      },
      async delete(key) {
        values.delete(key);
      },
      async setAlarm(value) {
        context.alarm = value;
      },
      async deleteAlarm() {
        context.alarm = undefined;
      },
    },
    waitUntil(promise) {
      pending.push(promise);
    },
    container: {
      images: { python: "image" },
      running: false,
      start(options) {
        this.running = true;
        context.options = options;
      },
      async setInactivityTimeout(ms) {
        context.idle = ms;
      },
      async destroy() {
        if (failure) throw new Error("unconfirmed");
        this.running = false;
      },
      async exec(command, options) {
        context.command = command;
        context.execOptions = options;
        return {
          stdin: new WritableStream({
            write(bytes) {
              sent = bytes;
            },
          }),
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0, 49]));
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          exitCode: Promise.resolve(0),
        };
      },
    },
  };
  return { context, pending, values, input: () => sent };
}

function request(method = "POST", headers = {}) {
  return new Request("https://case/attempt", {
    method,
    headers: {
      "x-case-language": "python",
      "x-case-token": "case-token-123456",
      "x-case-memory": "268435456",
      "x-case-processes": "16",
      ...headers,
    },
    ...(method === "POST" ? { body: "case-input" } : {}),
  });
}

test("direct case forwards current input and confirms teardown before its terminal frame", async () => {
  const { context, pending, values, input } = fixture();
  const sandbox = new CaseSandbox(context, {});
  const response = await sandbox.fetch(request());
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Promise.all(pending);
  assert.deepEqual([...input()], [...new TextEncoder().encode("case-input")]);
  assert.equal(context.options.image, "image");
  assert.equal(context.options.enableInternet, false);
  assert.equal(context.execOptions.user, "0:0");
  assert.equal(bytes[0], 1);
  assert.equal(bytes[10], 3);
  assert.equal(bytes[22], 4);
  assert.equal(context.container.running, false);
  assert.equal(values.has("started"), false);
  assert.equal(context.alarm, undefined);
});

test("invalid limits do not start a case and uncertain teardown remains fenced", async () => {
  const invalid = fixture();
  assert.equal(
    (
      await new CaseSandbox(invalid.context, {}).fetch(
        request("POST", { "x-case-memory": "999999999" }),
      )
    ).status,
    400,
  );
  assert.equal(invalid.context.container.running, false);
  const failed = fixture({ failure: true });
  const sandbox = new CaseSandbox(failed.context, {});
  const response = await sandbox.fetch(request());
  await assert.rejects(() => response.arrayBuffer());
  assert.equal(failed.values.get("started"), "case-token-123456");
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 503);
});

test("teardown fences a case whose input is still arriving", async () => {
  const { context } = fixture();
  const sandbox = new CaseSandbox(context, {});
  let controller;
  const body = new ReadableStream({
    start(value) {
      controller = value;
    },
  });
  const pending = sandbox.fetch(
    new Request("https://case/attempt", {
      method: "POST",
      duplex: "half",
      body,
      headers: {
        "x-case-language": "python",
        "x-case-token": "case-token-123456",
        "x-case-memory": "268435456",
        "x-case-processes": "16",
      },
    }),
  );
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 204);
  controller.enqueue(new Uint8Array([1]));
  controller.close();
  assert.equal((await pending).status, 503);
  assert.equal(context.container.running, false);
  assert.equal((await sandbox.fetch(request())).status, 503);
  assert.equal(context.container.running, false);
  const next = await sandbox.fetch(request("POST", { "x-case-token": "case-token-next-123456" }));
  assert.equal(next.status, 200);
  await next.arrayBuffer();
});
