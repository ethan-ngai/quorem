/** @file case-sandbox.test.mjs @description Native case lifecycle regressions. @module judging */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CaseSandbox } from "./case-sandbox.js";

function newSandbox(context, env = {}) {
  return new CaseSandbox(context, {
    CASES: {
      getByName: () => ({
        fetch: async (request) =>
          request.method === "GET"
            ? Response.json({ active: false, running: false, ordinal: null, tokenHash: null })
            : new Response(null, { status: 204 }),
      }),
    },
    ...env,
  });
}

function fixture({ failure = false, streamFailure = false } = {}) {
  const values = new Map();
  const pending = [];
  let sent = new Uint8Array();
  const context = {
    storage: {
      transaction(run) {
        const pending = (context.transaction ?? Promise.resolve()).then(() => run(context.storage));
        context.transaction = pending.catch(() => {});
        return pending;
      },
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        if (typeof key === "object")
          for (const [name, item] of Object.entries(key)) values.set(name, item);
        else values.set(key, value);
      },
      async delete(key) {
        for (const name of Array.isArray(key) ? key : [key]) values.delete(name);
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
      async inspect() {
        return this.running ? { image: "image", labels: {} } : null;
      },
      async destroy() {
        if (failure) throw new Error("unconfirmed");
        this.running = false;
      },
      async exec(command, options) {
        context.command = command;
        context.execOptions = options;
        assert.ok(options.stdin instanceof ReadableStream);
        sent = new Uint8Array(await new Response(options.stdin).arrayBuffer());
        return {
          stdout: new ReadableStream({
            start(controller) {
              if (streamFailure) {
                controller.error(new Error("stream unavailable"));
                return;
              }
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
      "x-case-token": "11111111-1111-4111-8111-111111111111",
      "x-case-memory": "268435456",
      "x-case-processes": "16",
      ...headers,
    },
    ...(method === "POST" ? { body: "case-input" } : {}),
  });
}

void test("parallel cases reuse one VM and publish before the slow case completes", async () => {
  const f = fixture();
  const sandbox = newSandbox(f.context);
  const container = f.context.container;
  const start = container.start.bind(container);
  let starts = 0;
  container.start = (options) => {
    starts++;
    start(options);
  };
  let release;
  let entered;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const enteredExec = new Promise((resolve) => {
    entered = resolve;
  });
  const exec = container.exec.bind(container);
  container.exec = async (command, options) => {
    if (command.at(-1).startsWith("1111")) {
      entered();
      await blocked;
    }
    return exec(command, options);
  };
  const slow = await sandbox.fetch(request());
  const slowResult = slow.arrayBuffer();
  await enteredExec;
  const fast = await sandbox.fetch(
    request("POST", {
      "x-case-token": "22222222-2222-4222-8222-222222222222",
    }),
  );
  const bytes = new Uint8Array(await fast.arrayBuffer());
  assert.equal(bytes.at(-8), 4);
  assert.equal(starts, 1);
  assert.equal(container.running, true);
  release();
  await slowResult;
  assert.equal((await sandbox.fetch(request("DELETE", { "x-case-token": "" }))).status, 204);
  assert.equal(container.running, false);
  assert.equal((await sandbox.fetch(request())).status, 503);
});

void test("case cancellation targets only its launcher cgroup", async () => {
  const f = fixture();
  const sandbox = newSandbox(f.context);
  const container = f.context.container;
  const exec = container.exec.bind(container);
  let release;
  let entered;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const enteredExec = new Promise((resolve) => {
    entered = resolve;
  });
  container.exec = async (command, options) => {
    if (command.at(-2) === "cancel") {
      assert.equal(command.at(-1), "11111111-1111-4111-8111-111111111111");
      release();
      return { exitCode: Promise.resolve(0) };
    }
    if (command.at(-1).startsWith("1111")) {
      entered();
      await blocked;
    }
    return exec(command, options);
  };
  const response = await sandbox.fetch(request());
  const rejected = assert.rejects(response.arrayBuffer(), /cancelled/);
  await enteredExec;
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 204);
  await rejected;
  assert.equal(container.running, true);
  const next = await sandbox.fetch(
    request("POST", {
      "x-case-token": "22222222-2222-4222-8222-222222222222",
    }),
  );
  assert.equal(new Uint8Array(await next.arrayBuffer()).at(-8), 4);
});

void test("uncertain attempt destruction retains the durable fence", async () => {
  const f = fixture({ failure: true });
  const sandbox = newSandbox(f.context);
  const response = await sandbox.fetch(request());
  await response.arrayBuffer();
  assert.equal((await sandbox.fetch(request("DELETE", { "x-case-token": "" }))).status, 503);
  assert.equal(f.values.get("started"), "python");
  assert.equal(f.values.get("cancelled"), true);
  assert.ok(f.context.alarm);
});
