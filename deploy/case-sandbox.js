/** @file case-sandbox.js @description Disposable native case lifecycle. @module judging */
import { encodeCaseFrame as frame } from "../packages/execution/src/frames.ts";
import { DurableObject } from "cloudflare:workers";
import { SHARED_CASE_CONCURRENCY } from "../packages/execution/src/scheduling.ts";

const MAX_INPUT = 8 * 1024 * 1024;
const FRAME_LIMIT = 64 * 1024;
const PYTHON_ALLOCATION_RETRY_MS = 4000;
const languages = new Set(["python", "java", "typescript", "ocaml", "postgresql"]);

async function input(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Case input missing");
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_INPUT) {
      await reader.cancel();
      throw new Error("Case input too large");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Owns one container and the isolated case processes for an execution attempt. */
export class CaseSandbox extends DurableObject {
  active = new Map();

  stop() {
    this.stopping ??= (async () => {
      await this.boot?.catch(() => {});
      this.phase = "stop-begin";
      console.log("case-lifecycle stop-begin");
      const started = await this.ctx.storage.get("started");
      this.phase = "destroy-begin";
      if (started || this.ctx.container.running) await this.ctx.container.destroy();
      this.phase = "destroy-complete";
      console.log("case-lifecycle destroy-complete");
      // Keep startup timings after teardown and Durable Object eviction.
      if (this.startup && this.env.CASE_DIAGNOSTICS === "true")
        await this.ctx.storage.put("startup-timing", this.startup);
      await this.ctx.storage.delete(["started", "deadline"]);
      await this.ctx.storage.deleteAlarm();
      this.phase = "stop-complete";
      console.log("case-lifecycle stop-complete");
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  async alarm() {
    const deadline = await this.ctx.storage.get("deadline");
    if (!deadline) return;
    if (deadline > Date.now()) {
      await this.ctx.storage.setAlarm(deadline);
      return;
    }
    this.cancelled = true;
    await this.ctx.storage.put("cancelled", true);
    await this.stop();
  }

  async fetch(request) {
    if (request.method === "GET" && request.headers.get("x-quorem-case-probe") === "lifecycle") {
      if (this.env.CASE_DIAGNOSTICS !== "true") return new Response(null, { status: 404 });
      const running = this.ctx.container?.running === true;
      const entry =
        running &&
        [...this.active.values()].find(
          (value) => value.ready && Number.isSafeInteger(value.ordinal),
        );
      const tokenHash = entry
        ? Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entry.token)),
            ),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("")
        : null;
      return Response.json({
        active: !!entry,
        running,
        ordinal: entry ? entry.ordinal : null,
        tokenHash,
      });
    }
    if (request.method === "GET" && this.env.CASE_DIAGNOSTICS === "true")
      return Response.json({
        actorId: this.ctx.id?.toString(),
        phase: this.phase ?? "idle",
        failure: this.failure ?? "none",
        source: this.failureSource ?? "none",
        ...(this.timing ? { timing: this.timing } : {}),
        startup: this.startup ?? (await this.ctx.storage.get("startup-timing")) ?? null,
      });
    if (request.method === "DELETE") {
      const token = request.headers.get("x-case-token");
      if (token && !/^[a-f0-9-]{36}$/.test(token)) return new Response(null, { status: 400 });
      try {
        if (token) {
          const entry = this.active.get(token);
          if (entry) {
            entry.cancelled = true;
            void entry.writer.abort(new Error("Case cancelled")).catch(() => {});
          }
          await this.ctx.storage.put(`cancel:${token}`, true);
          if (entry?.launched) {
            const cleanup = await this.ctx.container.exec(
              ["/usr/bin/env", "python3", "-B", "/opt/quorem/launcher.py", "cancel", token],
              { user: "0:0", stdout: "ignore", stderr: "ignore" },
            );
            if ((await cleanup.exitCode) !== 0) throw new Error("Case cleanup unconfirmed");
            this.active.delete(token);
          } else if (!entry && !this.boot && (await this.ctx.storage.get("started"))) {
            // An evicted owner cannot certify individual process cleanup.
            throw new Error("Case owner unavailable");
          }
        } else {
          this.cancelled = true;
          for (const entry of this.active.values())
            void entry.writer.abort(new Error("Attempt cancelled")).catch(() => {});
          await this.ctx.storage.put("cancelled", true);
          await this.stop();
        }
        return new Response(null, { status: 204 });
      } catch {
        return new Response(null, { status: 503 });
      }
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (this.cancelled || (await this.ctx.storage.get("cancelled")))
      return new Response(null, { status: 503 });
    if (this.stopping || this.active.size >= SHARED_CASE_CONCURRENCY)
      return new Response(null, { status: 409 });
    const language = request.headers.get("x-case-language");
    const token = request.headers.get("x-case-token");
    const memory = Number(request.headers.get("x-case-memory"));
    const processes = Number(request.headers.get("x-case-processes"));
    if (
      !languages.has(language) ||
      !/^[a-f0-9-]{36}$/.test(token ?? "") ||
      !Number.isSafeInteger(memory) ||
      memory < 1 ||
      memory > 268435456 ||
      !Number.isInteger(processes) ||
      processes < 1 ||
      processes > 64
    )
      return new Response(null, { status: 400 });
    const rawOrdinal = request.headers.get("x-quorem-case-ordinal");
    const ordinal =
      /^(-1|0|[1-9][0-9]{0,9})$/.test(rawOrdinal ?? "") && Number(rawOrdinal) <= 2147483646
        ? Number(rawOrdinal)
        : undefined;
    if (this.active.has(token)) return new Response(null, { status: 409 });
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const active = { token, ordinal, writer, cancelled: false, launched: false, ready: false };
    this.active.set(token, active);
    this.ctx.waitUntil(this.executeCase(request, active, language, memory, processes));
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "application/octet-stream",
        "x-quorem-case-admitted-at": String(Date.now()),
      },
    });
  }

  async startAttempt(language) {
    const began = performance.now();
    const startup = (this.startup = { maxExecMs: 0 });
    const container = this.ctx.container;
    const image = container.images?.[language];
    if (!image || container.running || (await this.ctx.storage.get("started")))
      throw new Error("Case container unavailable");
    if (await this.ctx.storage.get("cancelled")) throw new Error("Attempt cancelled");
    const deadline = Date.now() + 180_000;
    await this.ctx.storage.put({ started: language, deadline });
    await this.ctx.storage.setAlarm(deadline);
    if (this.cancelled) throw new Error("Attempt cancelled");
    const start = () =>
      container.start({
        image,
        instance: { vcpu: SHARED_CASE_CONCURRENCY, memoryMib: 3072, diskMb: 4000 },
        enableInternet: false,
      });
    startup.setupMs = Math.round(performance.now() - began);
    start();
    if (language !== "python") return;

    // All lanes wait for boot, so an allocation can be replaced before any child starts.
    this.phase = "allocation";
    const allocationBegan = performance.now();
    const retryAt = Date.now() + PYTHON_ALLOCATION_RETRY_MS;
    let pause = 25;
    for (;;) {
      const remaining = retryAt - Date.now();
      if (remaining <= 0) break;
      // The provider can hold inspect() past the allocation deadline.
      let timer;
      const allocation = await Promise.race([
        container.inspect(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), remaining);
        }),
      ]).finally(() => clearTimeout(timer));
      if (this.cancelled) throw new Error("Attempt cancelled");
      if (allocation?.image === image) {
        startup.allocationMs = Math.round(performance.now() - allocationBegan);
        return;
      }
      if (allocation?.image) throw new Error("Case image changed");
      const wait = retryAt - Date.now();
      if (wait <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pause, wait)));
      pause = Math.min(pause * 2, 250);
    }
    const destroying = performance.now();
    startup.allocationMs = Math.round(destroying - allocationBegan);
    await container.destroy();
    startup.replacementCleanupMs = Math.round(performance.now() - destroying);
    if (this.cancelled) throw new Error("Attempt cancelled");
    console.log("case-lifecycle allocation-retry python");
    start();
  }

  async executeCase(request, active, language, memory, processes) {
    const { token, writer } = active;
    const admitted = performance.now();
    const timing = (this.timing = {});
    let step = "setup";
    const check = () => {
      if (this.cancelled || active.cancelled) throw new Error("Case cancelled");
    };
    try {
      await writer.write(frame(1, new Uint8Array()));
      if (
        (await this.ctx.storage.get("cancelled")) ||
        (await this.ctx.storage.get(`cancel:${token}`))
      )
        throw new Error("Case cancelled");
      const bytes = await input(request);
      check();
      const started = performance.now();
      timing.inputMs = Math.round(started - admitted);
      this.language ??= language;
      if (language !== this.language) throw new Error("Case language changed");
      this.boot ??= this.startAttempt(language);
      await this.boot;
      check();
      const container = this.ctx.container;
      // The live response keeps this invocation active; the durable alarm fences abandoned runs.
      this.phase = "exec-begin";
      const stdin = new ReadableStream(
        {
          pull: (controller) => {
            if (this.cancelled || active.cancelled) {
              controller.error(new Error("Case cancelled"));
              return;
            }
            controller.enqueue(bytes);
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      active.launched = true;
      const execBegan = performance.now();
      const process = await container.exec(
        [
          "/usr/bin/env",
          "python3",
          "-B",
          "/opt/quorem/launcher.py",
          language,
          String(memory),
          String(processes),
          token,
        ],
        { user: "0:0", stdin, stdout: "pipe", stderr: "pipe" },
      );
      check();
      active.ready = true;
      this.phase = "exec-ready";
      const ready = performance.now();
      this.startup.maxExecMs = Math.max(this.startup.maxExecMs, Math.round(ready - execBegan));
      timing.startupMs = Math.round(ready - started);
      timing.execMs = timing.startupMs;
      console.log(`case-lifecycle exec-created duration_ms=${timing.execMs}`);
      console.log(`case-lifecycle exec-ready ${language}`);
      console.log(
        `Case started language=${language} duration_ms=${Math.round(performance.now() - started)}`,
      );
      if (!process.stdout || !process.stderr) throw new Error("Case streams unavailable");
      const pump = async (readable, channel) => {
        const reader = readable.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          for (let i = 0; i < value.byteLength; i += FRAME_LIMIT)
            await writer.write(frame(channel, value.subarray(i, i + FRAME_LIMIT)));
        }
      };
      step = "streams";
      const [, , exitCode] = await Promise.all([
        pump(process.stdout, 1),
        pump(process.stderr, 2),
        process.exitCode,
      ]);
      this.phase = "streams-complete";
      timing.executionMs = Math.round(performance.now() - ready);
      console.log(`case-lifecycle streams-complete ${language}`);
      const exit = new Uint8Array(4);
      new DataView(exit.buffer).setInt32(0, exitCode);
      check();

      step = "exit-frame";
      await writer.write(frame(3, exit));
      step = "terminal-frame";
      await writer.write(frame(4, new Uint8Array()));
      step = "close";
      timing.totalMs = Math.round(performance.now() - admitted);
      this.active.delete(token);
      await writer.close();
    } catch (error) {
      this.failure = this.phase;
      this.failureSource = step;
      console.log(`case-lifecycle stream-failed ${language}`);
      await writer.abort(error).catch(() => {});
    } finally {
      timing.totalMs = Math.round(performance.now() - admitted);
      if (!active.launched) this.active.delete(token);
    }
  }
}
