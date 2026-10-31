import { bytesInput } from "./input.ts";
/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { defaultLimits } from "@quorem/execution";
import { dockerSandbox } from "./docker.ts";
import { assertCaseOutput } from "./proof.ts";
const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
void test(
  "real Docker isolates a Python case and confirms exact daemon teardown",
  { skip: !socket, timeout: 60000 },
  async (t) => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-fence-test-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "fixture-scope",
      cleanupMs: 10000,
    });
    const fence = { attemptId: randomUUID(), sandboxScope: sandbox.scope };
    const input = new TextEncoder().encode(
      JSON.stringify({
        source: "class Solution:\n def f(self): return 7",
        signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
        args: [],
        calls: [],
        methods: [],
      }),
    );
    const request = {
      fence,
      binding: "a".repeat(64),
      ordinal: 0,
      language: "python",
      limits: defaultLimits(),
      input: bytesInput(input),
      outputLimit: 65536,
      timeoutMs: 30000,
    };
    const output = await sandbox.runCase(request);
    assert.doesNotThrow(() => assertCaseOutput(request, output));
    assert.throws(() => assertCaseOutput({ ...request, ordinal: 1 }, output), /Unconfirmed/);
    assert.throws(() => assertCaseOutput(request, { ...output }), /Unconfirmed/);
    assert.equal(output.exitCode, 0);
    const raw = new TextDecoder().decode(output.stdout);
    assert.equal(raw.charCodeAt(0), 0);
    assert.equal(JSON.parse(raw.slice(1)).actual, 7);
    await assert.rejects(
      sandbox.teardownAttempt({ ...fence, sandboxScope: "wrong" }),
      /unconfirmed/,
    );
    const isolationInput = new TextEncoder().encode(
      JSON.stringify({
        source:
          "class Solution:\n def f(self):\n  import os,socket\n  s=socket.socket(); s.settimeout(0.2)\n  try: s.connect(('1.1.1.1',53)); network=True\n  except OSError: network=False\n  return [network,os.path.exists('/var/run/docker.sock'),bool(os.getenv('QUOREM_FIXTURE_SENTINEL'))]",
        signature: {
          className: "Solution",
          methodName: "f",
          parameters: [],
          returnType: "list<bool>",
        },
        args: [],
        calls: [],
        methods: [],
      }),
    );
    process.env.QUOREM_FIXTURE_SENTINEL = "fixture-not-for-sandbox";
    try {
      const isolated = await sandbox.runCase({
        fence,
        binding: "a".repeat(64),
        ordinal: 1,
        language: "python",
        limits: defaultLimits(),
        input: bytesInput(isolationInput),
        outputLimit: 65536,
        timeoutMs: 30000,
      });
      assert.deepEqual(JSON.parse(new TextDecoder().decode(isolated.stdout).slice(1)).actual, [
        false,
        false,
        false,
      ]);
    } finally {
      delete process.env.QUOREM_FIXTURE_SENTINEL;
    }
    const controller = new AbortController();
    const running = sandbox.runCase(
      {
        fence,
        binding: "a".repeat(64),
        ordinal: 2,
        language: "python",
        limits: defaultLimits(),
        input: bytesInput(
          new TextEncoder().encode(
            JSON.stringify({
              source: "class Solution:\n def f(self):\n  while True: pass",
              signature: {
                className: "Solution",
                methodName: "f",
                parameters: [],
                returnType: "int",
              },
              args: [],
              calls: [],
              methods: [],
            }),
          ),
        ),
        outputLimit: 65536,
        timeoutMs: 30000,
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 1000);
    await assert.rejects(running);
    await sandbox.teardownAttempt(fence);
    await assert.rejects(sandbox.runCase(request), /terminated/);
  },
);
void test(
  "cross-process teardown waits for delayed daemon create and persists its tombstone",
  { skip: !socket, timeout: 60000 },
  async (t) => {
    const { spawn, execFileSync } = await import("node:child_process");
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-crossprocess-fence-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const daemon = execFileSync(
      "docker",
      ["--config", "/nonexistent", "--host", `unix://${socket}`, "info", "--format", "{{.ID}}"],
      { encoding: "utf8" },
    ).trim();
    const namespace = "crossprocess",
      sandbox = await dockerSandbox({ socket: socket!, stateRoot, namespace, cleanupMs: 10000 }),
      attempt = randomUUID(),
      fence = { attemptId: attempt, sandboxScope: sandbox.scope };
    const child = spawn(
      process.execPath,
      [
        new URL("./fence-child.mjs", import.meta.url).pathname,
        stateRoot,
        namespace,
        daemon,
        socket!,
        attempt,
        "delayed",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    t.after(() => child.kill("SIGKILL"));
    const closed = once(child, "close");
    const [first] = await Promise.race([
      once(child.stdout, "data"),
      closed.then(() => {
        throw new Error("fence child exited early");
      }),
    ]);
    assert.match(String(first), /locked/);
    let finished = false;
    const stopping = sandbox.teardownAttempt(fence).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(finished, false);
    let output = "";
    child.stdout.on("data", (part) => {
      output += String(part);
    });
    child.stdin.write("continue");
    const [exit] = await closed;
    assert.equal(exit, 0);
    await stopping;
    assert.match(output, /created/);
    const restarted = execFileSync(
      process.execPath,
      [
        new URL("./fence-child.mjs", import.meta.url).pathname,
        stateRoot,
        namespace,
        daemon,
        socket!,
        attempt,
        "check",
      ],
      { encoding: "utf8" },
    );
    assert.match(restarted, /terminated/);
    await assert.rejects(
      sandbox.runCase({
        fence,
        binding: "a".repeat(64),
        ordinal: 0,
        language: "python",
        limits: defaultLimits(),
        input: bytesInput(new Uint8Array([1])),
        outputLimit: 65536,
        timeoutMs: 1000,
      }),
      /terminated/,
    );
  },
);
void test(
  "a lost process lock is never reclaimed by elapsed time",
  { skip: !socket, timeout: 30000 },
  async (t) => {
    const { spawn, execFileSync } = await import("node:child_process");
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-crash-fence-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const daemon = execFileSync(
        "docker",
        ["--config", "/nonexistent", "--host", `unix://${socket}`, "info", "--format", "{{.ID}}"],
        { encoding: "utf8" },
      ).trim(),
      namespace = "crash";
    const sandbox = await dockerSandbox({ socket: socket!, stateRoot, namespace, cleanupMs: 300 }),
      attempt = randomUUID(),
      fence = { attemptId: attempt, sandboxScope: sandbox.scope };
    const child = spawn(
      process.execPath,
      [
        new URL("./fence-child.mjs", import.meta.url).pathname,
        stateRoot,
        namespace,
        daemon,
        socket!,
        attempt,
        "hold",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    t.after(() => child.kill("SIGKILL"));
    const closed = once(child, "close");
    await Promise.race([
      once(child.stdout, "data"),
      closed.then(() => {
        throw new Error("fence child exited early");
      }),
    ]);
    child.kill("SIGKILL");
    await closed;
    await assert.rejects(sandbox.teardownAttempt(fence), /unconfirmed/);
  },
);
void test(
  "real Docker streams a large case and rejects a false input digest",
  { skip: !socket, timeout: 60000 },
  async (t) => {
    const { createHash } = await import("node:crypto");
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-stream-input-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "stream-input",
      cleanupMs: 10000,
    });
    const prefix = Buffer.from(
      '{"source":"class Solution:\\n def f(self,x): return len(x)","signature":{"className":"Solution","methodName":"f","parameters":[{"name":"x","type":"str"}],"returnType":"int"},"args":["',
    );
    const part = Buffer.alloc(65536, 120),
      count = 32,
      suffix = Buffer.from('"],"calls":[],"methods":[]}');
    const digest = createHash("sha256").update(prefix);
    for (let i = 0; i < count; i++) digest.update(part);
    const input = {
      size: prefix.length + part.length * count + suffix.length,
      hash: digest.update(suffix).digest("hex"),
      async *open() {
        yield prefix;
        for (let i = 0; i < count; i++) yield part;
        yield suffix;
      },
    };
    const fence = { attemptId: randomUUID(), sandboxScope: sandbox.scope };
    const request = {
      fence,
      binding: "a".repeat(64),
      ordinal: 0,
      language: "python",
      limits: defaultLimits(),
      input,
      outputLimit: 65536,
      timeoutMs: 30000,
    };
    const result = await sandbox.runCase(request);
    assert.equal(result.exitCode, 0, new TextDecoder().decode(result.stderr));
    assert.equal(
      JSON.parse(new TextDecoder().decode(result.stdout).slice(1)).actual,
      part.length * count,
    );
    await assert.rejects(
      sandbox.runCase({ ...request, ordinal: 1, input: { ...input, hash: "0".repeat(64) } }),
    );
    await sandbox.teardownAttempt(fence);
  },
);
