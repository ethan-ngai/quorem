/** @file docker.ts @description Local daemon case isolation and exact-scope teardown. @module runner */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { AttemptFence } from "@quorem/execution";
import { CaseOutputLimit, readinessBudget } from "./budget.ts";
import { confirmCaseFailure, confirmCaseOutput } from "./proof.ts";
import { localFenceRoot } from "./fence.ts";
import {
  type CaseRequest,
  type CaseOutput,
  type IsolatedSandbox,
  UnconfirmedTeardown,
  validateCaseRequest,
} from "./types.ts";

interface ProcessResult {
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}
function invoke(
  binary: string,
  args: string[],
  options: {
    input?: Uint8Array;
    signal?: AbortSignal;
    maxOut: number;
    maxErr: number;
    onStdout?: (data: Uint8Array) => void;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    let out = 0,
      err = 0,
      exceeded = false,
      outputError: unknown;
    const collect = (target: Buffer[], limit: number, isOut: boolean) => (data: Buffer) => {
      if (isOut) out += data.length;
      else err += data.length;
      if (isOut && options.onStdout) {
        try {
          options.onStdout(data);
        } catch (error) {
          outputError = error;
          child.kill("SIGKILL");
          return;
        }
      }
      if ((isOut ? out : err) > limit) {
        exceeded = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(data);
    };
    child.stdout.on("data", collect(output, options.maxOut, true));
    child.stderr.on("data", collect(errors, options.maxErr, false));
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
    const abort = () => child.kill("SIGKILL");
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new Error("Docker command unavailable"));
    });
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) return reject(new Error("Sandbox operation aborted"));
      if (outputError) return reject(outputError);
      if (exceeded) return reject(new CaseOutputLimit());
      if (code === null) return reject(new Error("Docker command failed"));
      resolve({ code, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) });
    });
  });
}
function scopeLabel(scope: string): string {
  return createHash("sha256").update(scope).digest("hex");
}
/** Only a local Unix daemon and a stable daemon identity can authorize teardown. */
export async function dockerSandbox(config: {
  socket: string;
  stateRoot: string;
  namespace: string;
  cleanupMs: number;
  binary?: string;
  images?: Partial<Record<"python" | "postgresql" | "java" | "typescript" | "ocaml", string>>;
}): Promise<IsolatedSandbox & { readonly scope: string }> {
  if (
    !config.socket.startsWith("/") ||
    typeof config.stateRoot !== "string" ||
    !config.stateRoot.startsWith("/") ||
    !config.namespace ||
    !Number.isSafeInteger(config.cleanupMs) ||
    config.cleanupMs < 1
  )
    throw new Error("Invalid Docker sandbox configuration");
  const binary = config.binary ?? "docker",
    prefix = ["--config", "/nonexistent", "--host", `unix://${config.socket}`];
  const cli = (
    args: string[],
    signal?: AbortSignal,
    maxOut = 65536,
    maxErr = 65536,
    input?: Uint8Array,
    onStdout?: (data: Uint8Array) => void,
  ) => invoke(binary, [...prefix, ...args], { signal, maxOut, maxErr, input, onStdout });
  const identity = async (signal?: AbortSignal) => {
    const r = await cli(["info", "--format", "{{.ID}}"], signal);
    const id = new TextDecoder().decode(r.stdout).trim();
    if (r.code !== 0 || !id) throw new UnconfirmedTeardown();
    return id;
  };
  const daemon = await identity(AbortSignal.timeout(config.cleanupMs));
  const fenceOwner = await localFenceRoot(config.stateRoot, config.namespace, daemon);
  const sandboxScope = fenceOwner.scope;
  const scope = scopeLabel(sandboxScope);
  const assertDaemon = async (signal?: AbortSignal) => {
    if ((await identity(signal)) !== daemon) throw new UnconfirmedTeardown();
  };
  const list = async (fence: AttemptFence, signal?: AbortSignal) => {
    if (fence.sandboxScope !== sandboxScope || !/^[A-Za-z0-9-]{1,128}$/.test(fence.attemptId))
      throw new UnconfirmedTeardown();
    await assertDaemon(signal);
    const r = await cli(
      [
        "ps",
        "-aq",
        "--no-trunc",
        "--filter",
        `label=quorem.scope=${scope}`,
        "--filter",
        `label=quorem.attempt=${fence.attemptId}`,
      ],
      signal,
      1024 * 1024,
    );
    if (r.code !== 0) throw new UnconfirmedTeardown();
    const ids = new TextDecoder().decode(r.stdout).trim().split(/\s+/).filter(Boolean);
    if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw new UnconfirmedTeardown();
    return ids;
  };
  const remove = async (fence: AttemptFence, signal?: AbortSignal) => {
    const deadline = AbortSignal.any([
      AbortSignal.timeout(config.cleanupMs),
      ...(signal ? [signal] : []),
    ]);
    try {
      for (const id of await list(fence, deadline)) {
        const r = await cli(["rm", "-f", "-v", id], deadline);
        if (r.code !== 0) throw new UnconfirmedTeardown();
      }
      if ((await list(fence, deadline)).length) throw new UnconfirmedTeardown();
      await assertDaemon(deadline);
    } catch {
      throw new UnconfirmedTeardown();
    }
  };
  return {
    scope: sandboxScope,
    async teardownAttempt(fence, signal) {
      const deadline = AbortSignal.any([
        AbortSignal.timeout(config.cleanupMs),
        ...(signal ? [signal] : []),
      ]);
      let lock: Awaited<ReturnType<typeof fenceOwner.acquire>> | undefined;
      try {
        lock = await fenceOwner.acquire(fence, deadline);
        await lock.terminate();
        await remove(fence, deadline);
      } catch {
        throw new UnconfirmedTeardown();
      } finally {
        if (lock)
          await lock.release().catch(() => {
            throw new UnconfirmedTeardown();
          });
      }
    },
    async runCase(request: CaseRequest, signal): Promise<CaseOutput> {
      validateCaseRequest(request, sandboxScope);
      const runtime = ["python", "postgresql", "java", "typescript", "ocaml"].includes(
        request.language,
      )
        ? (config.images?.[
            request.language as "python" | "postgresql" | "java" | "typescript" | "ocaml"
          ] ?? `quorem-${request.language === "postgresql" ? "postgres" : request.language}:local`)
        : undefined;
      if (!runtime || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(runtime))
        throw new Error("Invalid sandbox image");
      await assertDaemon(signal);
      const name = `quorem-ts-${scope.slice(0, 16)}-${request.fence.attemptId}-${request.ordinal < 0 ? "compile" : request.ordinal}`;
      const budget = readinessBudget({
        initialMs: 10000,
        compileMs: request.compileMs ?? 60000,
        wallMs: request.limits.wallTimeMs,
        markers: ["python", "postgresql"].includes(request.language) ? 1 : 2,
        signal,
      });
      const timeout = AbortSignal.any([AbortSignal.timeout(request.timeoutMs), budget.signal]);
      const tmp = request.language === "postgresql" ? "134217728" : "16777216";
      let lock: Awaited<ReturnType<typeof fenceOwner.acquire>> | undefined;
      let failure: unknown;
      let cleaned = false;
      try {
        lock = await fenceOwner.acquire(request.fence, timeout);
        await lock.assertOpen();
        const created = await cli(
          [
            "create",
            "-i",
            "--name",
            name,
            "--user",
            "65534:65534",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--memory",
            String(request.limits.memoryBytes),
            "--memory-swap",
            String(request.limits.memoryBytes),
            "--pids-limit",
            String(request.limits.maxProcesses),
            "--cpus",
            "1",
            "--tmpfs",
            `/tmp:rw,noexec,nosuid,size=${tmp}`,
            "--label",
            `quorem.scope=${scope}`,
            "--label",
            `quorem.attempt=${request.fence.attemptId}`,
            runtime,
          ],
          timeout,
        );
        if (
          created.code !== 0 ||
          !/^[a-f0-9]{64}$/.test(new TextDecoder().decode(created.stdout).trim())
        )
          throw new Error("Sandbox creation failed");
        const id = new TextDecoder().decode(created.stdout).trim();
        const result = await cli(
          ["start", "-a", "-i", id],
          timeout,
          request.outputLimit * 6 + 1024,
          request.limits.outputBytes,
          request.input,
          budget.observe,
        );
        if (!budget.ready()) throw new Error("Sandbox did not become ready");
        return confirmCaseOutput(request, {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.code,
          compilationMs: budget.compilationMs(),
        });
      } catch (error) {
        failure = budget.deadline() ?? error;
      } finally {
        budget.close();
        if (lock) {
          await remove(request.fence);
          await lock.release();
          cleaned = true;
        }
      }
      if (cleaned && failure instanceof Error) throw confirmCaseFailure(request, failure);
      throw failure;
    },
  };
}
