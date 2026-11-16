/** @file budget.ts @description Separate startup, compilation and contestant deadlines. @module runner */
import {
  CASE_COMPILE_TIMEOUT,
  CASE_EXECUTION_TIMEOUT,
  CASE_COMPILE_WATCHDOG,
  CASE_EXECUTION_WATCHDOG,
} from "@quorem/execution";

export class CaseDeadline extends Error {
  readonly phase: "startup" | "compile" | "case";
  readonly limit: "cpu" | "watchdog" | "transport";
  constructor(
    phase: "startup" | "compile" | "case",
    limit: "cpu" | "watchdog" | "transport" = "cpu",
  ) {
    super("Sandbox deadline exceeded");
    this.phase = phase;
    this.limit = limit;
  }
}
/** @returns A contestant deadline reported by the trusted supervisor. */
export function sandboxDeadline(code: number): CaseDeadline | undefined {
  switch (code) {
    case CASE_COMPILE_TIMEOUT:
      return new CaseDeadline("compile", "cpu");
    case CASE_EXECUTION_TIMEOUT:
      return new CaseDeadline("case", "cpu");
    case CASE_COMPILE_WATCHDOG:
      return new CaseDeadline("compile", "watchdog");
    case CASE_EXECUTION_WATCHDOG:
      return new CaseDeadline("case", "watchdog");
  }
}
export class CaseOutputLimit extends Error {
  constructor() {
    super("Sandbox output exceeded");
  }
}
/** First NUL marks trusted launcher readiness; compiled modes require a second marker. */
export function readinessBudget(options: {
  initialMs: number;
  compileMs?: number;
  wallMs?: number;
  markers: number;
  compiledCpu?: boolean;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  let phase: "startup" | "compile" | "case" = "startup",
    count = 0,
    expired: CaseDeadline | undefined,
    first = 0,
    compilationMs = 0;
  let timingBytes = 0;
  let timer: ReturnType<typeof setTimeout>;
  const arm = (duration: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      expired = new CaseDeadline(phase, "transport");
      controller.abort();
    }, duration);
  };
  arm(options.initialMs);
  const observe = (data: Uint8Array) => {
    let at = 0;
    while (count < options.markers && at < data.length) {
      if (data[at++] !== 0) throw new Error("Missing sandbox readiness marker");
      count++;
      if (count === 1) first = performance.now();
      if (count === options.markers) {
        if (options.compiledCpu) timingBytes = 4;
        else if (options.markers > 1) compilationMs = Math.max(0, performance.now() - first);
        phase = "case";
        if (options.wallMs === undefined) clearTimeout(timer);
        else arm(options.wallMs);
      } else {
        phase = "compile";
        if (options.compileMs === undefined) clearTimeout(timer);
        else arm(options.compileMs);
      }
    }
    const markerEnd = at;
    while (timingBytes && at < data.length) {
      compilationMs = compilationMs * 256 + data[at++];
      timingBytes--;
    }
    if (at === markerEnd) return data;
    const output = new Uint8Array(markerEnd + data.length - at);
    output.set(data.subarray(0, markerEnd));
    output.set(data.subarray(at), markerEnd);
    return output;
  };
  return {
    signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]),
    observe,
    deadline: () => expired,
    ready: () => count === options.markers && timingBytes === 0,
    compilationMs: () => compilationMs,
    close: () => clearTimeout(timer),
  };
}
