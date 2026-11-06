import { test } from "node:test";
import assert from "node:assert/strict";
import { CASE_LANES } from "../packages/execution/src/scheduling.ts";
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
        return {
          stdin: new WritableStream({
            write(bytes) {
              sent = bytes;
            },
          }),
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
      "x-quorem-case-lanes": String(CASE_LANES),
      "x-case-token": "case-token-123456",
      "x-case-memory": "268435456",
      "x-case-processes": "16",
      ...headers,
    },
    ...(method === "POST" ? { body: "case-input" } : {}),
  });
}

void test("case lifecycle diagnostics require the validation binding", async () => {
  const { context } = fixture();
  assert.equal((await newSandbox(context, {}).fetch(request("GET"))).status, 405);
  const sandbox = newSandbox(context, { CASE_DIAGNOSTICS: "true" });
  assert.deepEqual(await (await sandbox.fetch(request("GET"))).json(), {
    phase: "idle",
    failure: "none",
    source: "none",
  });
  const response = await sandbox.fetch(request());
  await response.arrayBuffer();
  const { timing, ...state } = await (await sandbox.fetch(request("GET"))).json();
  assert.deepEqual(state, {
    phase: "stop-complete",
    failure: "none",
    source: "none",
  });
  for (const name of ["inputMs", "startupMs", "executionMs", "teardownMs", "totalMs"])
    assert.ok(Number.isSafeInteger(timing[name]) && timing[name] >= 0);
});

void test("case diagnostics preserve the failed stream source after teardown", async () => {
  const { context } = fixture({ streamFailure: true });
  const sandbox = newSandbox(context, { CASE_DIAGNOSTICS: "true" });
  const response = await sandbox.fetch(request());
  await assert.rejects(() => response.arrayBuffer());
  const diagnostic = await (await sandbox.fetch(request("GET"))).json();
  assert.equal(diagnostic.source, "stdout");
  assert.equal(diagnostic.phase, "stop-complete");
});

void test("direct case forwards current input and confirms teardown before its terminal frame", async () => {
  const { context, pending, values, input } = fixture();
  const sandbox = newSandbox(context, {});
  const response = await sandbox.fetch(request());
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Promise.all(pending);
  assert.deepEqual([...input()], [...new TextEncoder().encode("case-input")]);
  assert.equal(context.options.image, "image");
  assert.equal(context.options.enableInternet, false);
  assert.equal(context.execOptions.user, "0:0");
  assert.equal(bytes[0], 1);
  assert.equal(new DataView(bytes.buffer).getUint32(4), 0);
  assert.equal(bytes[18], 3);
  assert.equal(bytes[30], 4);
  assert.equal(context.container.running, false);
  assert.equal(values.has("started"), false);
  assert.equal(context.alarm, undefined);
});

void test("waits for the configured VM image before issuing exec", async () => {
  const { context, pending } = fixture();
  let inspections = 0;
  context.container.inspect = async () => ({ image: ++inspections < 3 ? "" : "image", labels: {} });
  const exec = context.container.exec.bind(context.container);
  context.container.exec = async (...args) => {
    assert.equal(inspections, 3);
    return exec(...args);
  };
  const response = await newSandbox(context).fetch(request());
  await response.arrayBuffer();
  await Promise.all(pending);
  assert.equal(inspections, 3);
  assert.equal(context.container.running, false);
});

void test("cancellation during boot prevents a later exec", async () => {
  const { context, pending } = fixture();
  let inspected;
  const booting = new Promise((resolve) => {
    inspected = resolve;
  });
  context.container.inspect = async () => {
    inspected();
    return { image: "", labels: {} };
  };
  const sandbox = newSandbox(context);
  const response = await sandbox.fetch(request());
  const reader = response.body.getReader();
  await reader.read();
  await booting;
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 204);
  await assert.rejects(reader.read(), /Case cancelled/);
  await Promise.all(pending);
  assert.equal(context.command, undefined);
  assert.equal(context.container.running, false);
});

void test("a late exec response cannot receive input after cancellation", async () => {
  const { context, pending, input } = fixture();
  let started, release;
  const executing = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const exec = context.container.exec.bind(context.container);
  context.container.exec = async (...args) => {
    started();
    await gate;
    return exec(...args);
  };
  const sandbox = newSandbox(context);
  const response = await sandbox.fetch(request());
  const reader = response.body.getReader();
  await reader.read();
  await executing;
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 204);
  release();
  await assert.rejects(reader.read(), /Case cancelled/);
  await Promise.all(pending);
  assert.equal(input().length, 0);
  assert.equal(context.container.running, false);
});

void test("image changes during startup fail closed and destroy the VM", async () => {
  const { context, pending } = fixture();
  context.container.inspect = async () => ({ image: "other-image", labels: {} });
  const response = await newSandbox(context).fetch(request());
  await assert.rejects(response.arrayBuffer(), /Case image changed/);
  await Promise.all(pending);
  assert.equal(context.command, undefined);
  assert.equal(context.container.running, false);
});

void test("invalid limits do not start a case and uncertain teardown remains fenced", async () => {
  const invalid = fixture();
  assert.equal(
    (await newSandbox(invalid.context, {}).fetch(request("POST", { "x-case-memory": "999999999" })))
      .status,
    400,
  );
  assert.equal(invalid.context.container.running, false);
  const failed = fixture({ failure: true });
  const sandbox = newSandbox(failed.context, { CASE_DIAGNOSTICS: "true" });
  const response = await sandbox.fetch(request());
  await assert.rejects(() => response.arrayBuffer());
  assert.equal((await (await sandbox.fetch(request("GET"))).json()).failure, "destroy-begin");
  assert.equal((await (await sandbox.fetch(request("GET"))).json()).source, "destroy");
  assert.equal(failed.values.get("started"), "case-token-123456");
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 503);
});

void test("teardown fences a case whose input is still arriving", async () => {
  const { context } = fixture();
  const sandbox = newSandbox(context, {});
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
  const admitted = await pending;
  assert.equal(admitted.status, 200);
  const content = admitted.arrayBuffer();
  void content.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await sandbox.fetch(request("DELETE"))).status, 204);
  controller.enqueue(new Uint8Array([1]));
  controller.close();
  await assert.rejects(content);
  assert.equal(context.container.running, false);
  assert.equal((await sandbox.fetch(request())).status, 503);
  assert.equal(context.container.running, false);
  const next = await sandbox.fetch(request("POST", { "x-case-token": "case-token-next-123456" }));
  assert.equal(next.status, 200);
  await next.arrayBuffer();
});

function laneNamespace({ failedLane } = {}) {
  const contexts = new Map(),
    objects = new Map(),
    releases = [];
  const env = {
    CASE_DIAGNOSTICS: "true",
    CASES: {
      getByName(name) {
        if (!objects.has(name)) {
          const f = fixture({ failure: name === failedLane });
          const exec = f.context.container.exec.bind(f.context.container);
          f.context.container.exec = async (...args) => {
            const process = await exec(...args);
            process.exitCode = new Promise((resolve) => releases.push(() => resolve(0)));
            return process;
          };
          contexts.set(name, f.context);
          objects.set(name, new CaseSandbox(f.context, env));
        }
        return { fetch: (request) => objects.get(name).fetch(request) };
      },
    },
  };
  return {
    env,
    contexts,
    releases,
    root: () => env.CASES.getByName("attempt"),
    evict() {
      objects.set("attempt", new CaseSandbox(contexts.get("attempt"), env));
    },
  };
}

void test(
  "attempt teardown after eviction stops every active native lane",
  { timeout: 5000 },
  async () => {
    const f = laneNamespace();
    const posts = Array.from({ length: CASE_LANES }, (_, ordinal) =>
      f.root().fetch(
        request("POST", {
          "x-quorem-case-ordinal": String(ordinal),
          "x-case-token": `case-token-parallel-${ordinal}`,
        }),
      ),
    );
    const responses = await Promise.all(posts);
    const readers = responses.map((response) => response.body.getReader());
    await Promise.all(readers.map((reader) => reader.read()));
    for (let tick = 0; tick < 100 && f.releases.length < CASE_LANES; tick++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.releases.length, CASE_LANES);
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(
      [...f.contexts.values()].filter((ctx) => ctx.container.running).length,
      CASE_LANES,
    );
    f.evict();
    const stop = await f.root().fetch(request("DELETE", { "x-case-token": "" }));
    assert.equal(stop.status, 204);
    assert.ok([...f.contexts.values()].every((ctx) => !ctx.container.running));
    assert.equal(
      (await f.root().fetch(request("POST", { "x-quorem-case-ordinal": "5" }))).status,
      503,
    );
    f.releases.forEach((release) => release());
    await Promise.all(
      readers.map(async (reader) => {
        while (!(await reader.read()).done) {}
      }),
    );
  },
);

void test(
  "one failed child teardown prevents attempt confirmation and can be retried",
  { timeout: 5000 },
  async () => {
    const f = laneNamespace({ failedLane: "attempt-lane-2" });
    const response = await f.root().fetch(request("POST", { "x-quorem-case-ordinal": "2" }));
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    await reader.read();
    for (let tick = 0; tick < 100 && f.releases.length < 1; tick++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.releases.length, 1);
    f.evict();
    assert.equal((await f.root().fetch(request("DELETE", { "x-case-token": "" }))).status, 503);
    const failed = f.contexts.get("attempt-lane-2");
    failed.container.destroy = async () => {
      failed.container.running = false;
    };
    assert.equal((await f.root().fetch(request("DELETE", { "x-case-token": "" }))).status, 204);
    f.releases.forEach((release) => release());
    while (!(await reader.read()).done) {}
  },
);

void test("attempt cleanup leaves connection headroom and still visits every lane", async () => {
  const f = fixture();
  f.values.set("used-lanes", (1 << CASE_LANES) - 1);
  let running = 0,
    peak = 0,
    visited = 0;
  const sandbox = newSandbox(f.context, {
    CASES: {
      getByName: () => ({
        fetch: async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
          visited++;
          return new Response(null, { status: 204 });
        },
      }),
    },
  });
  assert.equal((await sandbox.fetch(request("DELETE", { "x-case-token": "" }))).status, 204);
  assert.equal(visited, CASE_LANES - 1);
  assert.equal(peak, 3);
});

void test("attempt cleanup fans out bodyless commands from a streamed DELETE request", async () => {
  const f = fixture();
  f.values.set("used-lanes", (1 << CASE_LANES) - 1);
  let visited = 0;
  const sandbox = newSandbox(f.context, {
    CASES: {
      getByName: () => ({
        fetch: async (command) => {
          assert.equal(command.body, null);
          visited++;
          return new Response(null, { status: 204 });
        },
      }),
    },
  });
  const incoming = new Request("https://case/attempt", {
    method: "DELETE",
    body: "",
    duplex: "half",
  });
  assert.notEqual(incoming.body, null);
  assert.equal((await sandbox.fetch(incoming)).status, 204);
  assert.equal(visited, CASE_LANES - 1);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

void test(
  "case admission headers and an empty frame arrive before native startup completes",
  { timeout: 2000 },
  async (t) => {
    const f = fixture(),
      entered = deferred(),
      release = deferred();
    t.after(() => release.resolve());
    const exec = f.context.container.exec.bind(f.context.container);
    f.context.container.exec = async (...args) => {
      entered.resolve();
      await release.promise;
      return exec(...args);
    };
    const response = await newSandbox(f.context).fetch(request());
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.value.length, 8);
    assert.equal(new DataView(first.value.buffer).getUint32(4), 0);
    await entered.promise;
    assert.equal(f.context.container.running, true);
    release.resolve();
    while (!(await reader.read()).done) {}
    await Promise.all(f.pending);
  },
);

void test(
  "early admission never certifies success before native destruction",
  { timeout: 2000 },
  async (t) => {
    const { decodeCaseFrames } = await import("../packages/execution/src/frames.ts");
    const f = fixture(),
      entered = deferred(),
      release = deferred();
    t.after(() => release.resolve());
    const destroy = f.context.container.destroy.bind(f.context.container);
    f.context.container.destroy = async () => {
      entered.resolve();
      await release.promise;
      await destroy();
    };
    const response = await newSandbox(f.context).fetch(request());
    let completed = false;
    const decoded = decodeCaseFrames(
      response.body,
      { stdoutBytes: 1024, stderrBytes: 1024 },
      async () => {},
    ).then((code) => {
      completed = true;
      return code;
    });
    void decoded.catch(() => {});
    await entered.promise;
    assert.equal(completed, false);
    assert.equal(f.context.container.running, true);
    release.resolve();
    assert.equal(await decoded, 0);
    assert.equal(f.context.container.running, false);
  },
);

void test("one-case attempts never create unused sibling lanes during confirmed cleanup", async () => {
  const f = fixture();
  const sandbox = newSandbox(f.context, {
    CASES: {
      getByName() {
        throw new Error("unused lane accessed");
      },
    },
  });
  await (await sandbox.fetch(request())).arrayBuffer();
  assert.equal(f.values.get("used-lanes"), 1);
  assert.equal((await sandbox.fetch(request("DELETE", { "x-case-token": "" }))).status, 204);
});
