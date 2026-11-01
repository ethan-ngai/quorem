/** @file hono-worker-diagnostic.mjs @description Bounded, redacted Worker startup diagnostics. @module deployment */
import { spawn } from "node:child_process";

/** Capture only application-owned diagnostic records; discard request metadata and provider output. */
export async function workerDiagnostic(env, name, origin) {
  const child = spawn("vp", ["-C", "apps/api", "exec", "wrangler", "tail", name, "--format", "json"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    if (output.length < 262144) output += chunk;
  });
  child.stderr.resume();
  child.on("error", () => {});
  try {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const response = await fetch(new URL("/api/auth/quorem-config", origin), {
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const match = output.match(/\\?"event\\?"\s*:\s*\\?"runtime-composition-failed/);
    // Provider JSON contains escaped console strings; decode only bounded known fields.
    const flattened = output.replaceAll('\\"', '"');
    const record = flattened.match(/\{"event":"runtime-composition-failed"[^\n]*?\}/)?.[0];
    if (match && record) {
      const value = JSON.parse(record);
      return {
        event: value.event,
        kind: /^[A-Za-z]+$/.test(value.kind) ? value.kind : undefined,
        frames: Array.isArray(value.frames) ? value.frames.filter((v) => /^[A-Za-z0-9_.]+$/.test(v)).slice(0, 6) : [],
        reason: ["Invalid runtime key", "Invalid runtime flag", "Invalid runtime limit", "Missing runtime configuration"].includes(value.reason) ? value.reason : undefined,
      };
    }
    return { event: "runtime-diagnostic-unavailable" };
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1000).unref();
  }
}
