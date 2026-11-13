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

void test("four cases share one VM and report independently", async () => {
  const f = fixture();
  const sandbox = newSandbox(f.context);
  const container = f.context.container;
  const start = container.start.bind(container);
  let starts = 0;
  container.start = (options) => {
    starts++;
    start(options);
  };
  const { promise: blocked, resolve: release } = Promise.withResolvers();
  const { promise: fourActive, resolve: reachedCapacity } = Promise.withResolvers();
  const { promise: fastReady, resolve: releaseFast } = Promise.withResolvers();
  const exec = container.exec.bind(container);
  const tokens = Array.from({ length: 5 }, () => crypto.randomUUID());
  let active = 0;
  container.exec = async (command, options) => {
    if (++active === 4) reachedCapacity();
    try {
      await (command.at(-1) === tokens[3] ? fastReady : blocked);
      return await exec(command, options);
    } finally {
      active--;
    }
  };
  const results = await Promise.all(
    tokens.slice(0, 4).map(async (token) => {
      const response = await sandbox.fetch(request("POST", { "x-case-token": token }));
      assert.equal(response.status, 200);
      return { body: response.arrayBuffer() };
    }),
  );
  await fourActive;
  const fifth = await sandbox.fetch(request("POST", { "x-case-token": tokens[4] }));
  assert.equal(fifth.status, 409);
  releaseFast();
  const bytes = new Uint8Array(await results[3].body);
  assert.equal(bytes.at(-8), 4);
  assert.equal(active, 3);
  assert.equal(starts, 1);
  assert.equal(f.context.options.instance.vcpu, 4);
  assert.equal(f.context.options.instance.memoryMib, 3072);
  assert.equal(container.running, true);
  release();
  await Promise.all(results.map(({ body }) => body));
  assert.equal((await sandbox.fetch(request("DELETE", { "x-case-token": "" }))).status, 204);
  assert.equal(container.running, false);
  assert.equal((await sandbox.fetch(request())).status, 503);
});

void test("a slow allocation is replaced once before any case starts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const f = fixture();
  const sandbox = newSandbox(f.context);
  const container = f.context.container;
  const start = container.start.bind(container);
  const destroy = container.destroy.bind(container);
  const exec = container.exec.bind(container);
  const events = [];
  container.start = (options) => {
    events.push("start");
    start(options);
  };
  container.inspect = async () => {
    t.mock.timers.tick(4001);
    return null;
  };
  container.destroy = async () => {
    events.push("destroy");
    await destroy();
  };
  container.exec = async (...args) => {
    events.push("exec");
    return exec(...args);
  };
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      const response = await sandbox.fetch(
        request("POST", { "x-case-token": crypto.randomUUID() }),
      );
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }),
  );
  assert.deepEqual(events, ["start", "destroy", "start", "exec", "exec", "exec", "exec"]);
  assert.equal((await sandbox.fetch(request("DELETE", { "x-case-token": "" }))).status, 204);
  assert.equal(container.running, false);
});

void test("cancellation while replacing an allocation prevents restart and execution", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const f = fixture();
  const sandbox = newSandbox(f.context);
  const container = f.context.container;
  const destroy = container.destroy.bind(container);
  const { promise: replacing, resolve: destroying } = Promise.withResolvers();
  const { promise: cancelled, resolve: cancellationStored } = Promise.withResolvers();
  const put = f.context.storage.put.bind(f.context.storage);
  f.context.storage.put = async (key, value) => {
    await put(key, value);
    if (key === "cancelled") cancellationStored();
  };
  container.inspect = async () => {
    t.mock.timers.tick(4001);
    return null;
  };
  container.destroy = async () => {
    destroying();
    await cancelled;
    await destroy();
  };
  container.exec = () => assert.fail("Cancelled allocation ran a case");
  const response = await sandbox.fetch(request());
  const failed = assert.rejects(response.arrayBuffer());
  await replacing;
  const stop = await sandbox.fetch(request("DELETE", { "x-case-token": "" }));
  await failed;
  assert.equal(stop.status, 204);
  assert.equal(container.running, false);
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
