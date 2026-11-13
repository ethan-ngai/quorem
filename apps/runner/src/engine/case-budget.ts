/** @file case-budget.ts @description Native limits derived from sealed input dimensions. @module runner */
import type { Job } from "@quorem/execution";
import {
  caseGrowth,
  decodeUtf8Chunks,
  parseLosslessJson,
  type CaseBudget,
} from "@quorem/questions";

const MiB = 1024 * 1024;
// Shared conservative startup and allocation allowances. Values are per runtime, not per question.
const nativeCosts = {
  "python-3.12-v1": { startupMs: 150, unitsPerMs: 2000, runtimeMiB: 48, bytesPerUnit: 96 },
  "java-21.0.9-v1": { startupMs: 250, unitsPerMs: 4000, runtimeMiB: 160, bytesPerUnit: 64 },
  "typescript-5.9.3-node-22.21.1-v1": {
    startupMs: 250,
    unitsPerMs: 3000,
    runtimeMiB: 128,
    bytesPerUnit: 96,
  },
  "ocaml-4.13.1-v1": { startupMs: 150, unitsPerMs: 4000, runtimeMiB: 64, bytesPerUnit: 64 },
} as const;

export async function readBudgetJson(chunks: AsyncIterable<Uint8Array>, maxChars: number) {
  let text = "";
  for await (const chunk of decodeUtf8Chunks(chunks)) {
    if (text.length + chunk.length > maxChars) return undefined;
    text += chunk;
  }
  return text;
}

export async function nativeCaseLimits(
  job: Job,
  budget: CaseBudget | undefined,
  args: () => AsyncIterable<Uint8Array>,
  compiling: boolean,
): Promise<Job["limits"]> {
  const cost = nativeCosts[job.runtimeRevision as keyof typeof nativeCosts];
  if (!budget || !cost) return job.limits;
  const raw = await readBudgetJson(args(), 256 * 1024);
  // Oversized cases keep the admitted envelope and remain in the suite.
  if (raw === undefined) return job.limits;
  const values = parseLosslessJson(raw);
  if (!Array.isArray(values)) throw new Error("Invalid budget arguments");
  const time = Number(caseGrowth(budget.time, values));
  const space = Number(caseGrowth(budget.space, values));
  return {
    ...job.limits,
    wallTimeMs: Math.min(job.limits.wallTimeMs, cost.startupMs + Math.ceil(time / cost.unitsPerMs)),
    memoryBytes: compiling
      ? job.limits.memoryBytes
      : Math.min(
          job.limits.memoryBytes,
          Math.ceil((cost.runtimeMiB * MiB + raw.length * 32 + space * cost.bytesPerUnit) / MiB) *
            MiB,
        ),
  };
}

export function caseMemoryReservation() {
  const capacity = 1024 * MiB;
  let reserved = 0;
  const waiting = new Set<() => void>();
  return async function reserve(bytes: number, signal: AbortSignal) {
    if (bytes > capacity) throw new Error("Case exceeds attempt memory capacity");
    while (reserved + bytes > capacity) {
      signal.throwIfAborted();
      await new Promise<void>((resolve) => {
        const wake = () => {
          waiting.delete(wake);
          signal.removeEventListener("abort", wake);
          resolve();
        };
        waiting.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      });
    }
    signal.throwIfAborted();
    reserved += bytes;
    return () => {
      reserved -= bytes;
      for (const wake of waiting) wake();
    };
  };
}
