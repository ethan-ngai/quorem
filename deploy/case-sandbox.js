import { DurableObject } from "cloudflare:workers";

const MAX_INPUT = 8 * 1024 * 1024;
const FRAME_LIMIT = 64 * 1024;
const languages = new Set(["python", "java", "typescript", "ocaml", "postgresql"]);

function frame(channel, bytes) {
  const output = new Uint8Array(8 + bytes.length);
  output[0] = channel;
  new DataView(output.buffer).setUint32(4, bytes.length);
  output.set(bytes, 8);
  return output;
}

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

/** One trusted launcher and one disposable container per execution case. */
export class CaseSandbox extends DurableObject {
  stop() {
    this.stopping ??= (async () => {
      this.phase = "stop-begin";
      console.log("case-lifecycle stop-begin");
      const started = await this.ctx.storage.get("started");
      this.phase = "destroy-begin";
      if (started || this.ctx.container.running) await this.ctx.container.destroy();
      this.phase = "destroy-complete";
      console.log("case-lifecycle destroy-complete");
      await this.ctx.storage.delete("started");
      await this.ctx.storage.delete("deadline");
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
    this.generation = (this.generation ?? 0) + 1;
    await this.ctx.storage.put("cancelled", true);
    await this.stop();
  }

  async fetch(request) {
    if (request.method === "GET" && request.headers.get("x-quorem-case-probe") === "lifecycle") {
      if (this.env.CASE_DIAGNOSTICS !== "true") return new Response(null, { status: 404 });
      const running = this.ctx.container?.running === true;
      const active =
        running &&
        this.phase === "exec-ready" &&
        !!this.active?.token &&
        Number.isSafeInteger(this.active.ordinal);
      const tokenHash = active
        ? Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.active.token)),
            ),
            (b) => b.toString(16).padStart(2, "0"),
          ).join("")
        : null;
      return Response.json({
        active,
        running,
        ordinal: active ? this.active.ordinal : null,
        tokenHash,
      });
    }
    if (request.method === "GET" && this.env.CASE_DIAGNOSTICS === "true")
      return Response.json({
        phase: this.phase ?? "idle",
        failure: this.failure ?? "none",
        source: this.failureSource ?? "none",
      });
    if (request.method === "DELETE") {
      console.log("case-lifecycle delete-begin");
      const token = request.headers.get("x-case-token");
      if (token && !/^[A-Za-z0-9-]{16,128}$/.test(token))
        return new Response(null, { status: 400 });
      if (!token || this.active?.token === token) this.generation = (this.generation ?? 0) + 1;
      try {
        await this.ctx.storage.put(token ? `cancel:${token}` : "cancelled", true);
        if (!token || (await this.ctx.storage.get("started")) === token) await this.stop();
        console.log("case-lifecycle delete-complete");
        return new Response(null, { status: 204 });
      } catch {
        return new Response(null, { status: 503 });
      }
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (this.active || this.stopping) return new Response(null, { status: 409 });
    const language = request.headers.get("x-case-language");
    const token = request.headers.get("x-case-token");
    const memory = Number(request.headers.get("x-case-memory"));
    const processes = Number(request.headers.get("x-case-processes"));
    if (
      !languages.has(language) ||
      !/^[A-Za-z0-9-]{16,128}$/.test(token ?? "") ||
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
    const active = { token, ordinal };
    this.phase = "admitted";
    this.failure = undefined;
    this.failureSource = undefined;
    this.active = active;
    const generation = this.generation ?? 0;
    try {
      if (
        (await this.ctx.storage.get("cancelled")) ||
        (await this.ctx.storage.get(`cancel:${token}`))
      )
        throw new Error("Case cancelled");
      const bytes = await input(request);
      if ((this.generation ?? 0) !== generation) throw new Error("Case cancelled");
      const container = this.ctx.container;
      if (
        container.running ||
        (await this.ctx.storage.get("started")) ||
        !container.images?.[language]
      )
        throw new Error("Case container unavailable");
      await this.ctx.storage.put("started", token);
      const deadline = Date.now() + 180_000;
      await this.ctx.storage.put("deadline", deadline);
      await this.ctx.storage.setAlarm(deadline);
      if ((this.generation ?? 0) !== generation) throw new Error("Case cancelled");
      const started = performance.now();
      container.start({
        image: container.images[language],
        instance: { vcpu: 1, memoryMib: 3072, diskMb: 4000 },
        enableInternet: false,
      });
      this.phase = "started";
      await container.setInactivityTimeout(180_000);
      this.phase = "exec-begin";
      const process = await container.exec(
        [
          "/usr/bin/env",
          "python3",
          "-B",
          "/opt/quorem/launcher.py",
          language,
          String(memory),
          String(processes),
        ],
        { user: "0:0", stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      this.phase = "exec-ready";
      console.log(`case-lifecycle exec-ready ${language}`);
      console.log(
        `Case started language=${language} duration_ms=${Math.round(performance.now() - started)}`,
      );
      if (!process.stdin || !process.stdout || !process.stderr)
        throw new Error("Case streams unavailable");
      const inputWriter = process.stdin.getWriter();
      const sendInput = (async () => {
        await inputWriter.write(bytes);
        await inputWriter.close();
      })();
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      const pump = async (readable, channel) => {
        const reader = readable.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          for (let i = 0; i < value.byteLength; i += FRAME_LIMIT)
            await writer.write(frame(channel, value.subarray(i, i + FRAME_LIMIT)));
        }
      };
      this.ctx.waitUntil(
        (async () => {
          let source;
          let step = "streams";
          const observe = (promise, name) =>
            promise.catch((error) => {
              source ??= name;
              throw error;
            });
          try {
            const [, , , exitCode] = await Promise.all([
              observe(sendInput, "input"),
              observe(pump(process.stdout, 1), "stdout"),
              observe(pump(process.stderr, 2), "stderr"),
              observe(process.exitCode, "exit"),
            ]);
            this.phase = "streams-complete";
            console.log(`case-lifecycle streams-complete ${language}`);
            const exit = new Uint8Array(4);
            new DataView(exit.buffer).setInt32(0, exitCode);
            step = "exit-frame";
            await writer.write(frame(3, exit));
            step = "destroy";
            await this.stop();
            step = "terminal-frame";
            await writer.write(frame(4, new Uint8Array()));
            step = "close";
            await writer.close();
          } catch (error) {
            this.failure = this.phase;
            this.failureSource = source ?? step;
            console.log(`case-lifecycle stream-failed ${language}`);
            try {
              await this.stop();
            } catch {
              /* Teardown remains unconfirmed. */
            }
            await writer.abort(error).catch(() => {});
          } finally {
            if (this.active === active) this.active = undefined;
          }
        })(),
      );
      return new Response(stream.readable, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    } catch {
      this.failure = this.phase;
      this.failureSource = "setup";
      try {
        await this.stop();
      } catch {
        /* Caller must retry teardown. */
      }
      if (this.active === active) this.active = undefined;
      return new Response(null, { status: 503 });
    }
  }
}
