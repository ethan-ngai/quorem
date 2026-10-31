/** @file budget.ts @description Separate startup, compilation and contestant deadlines. @module runner */
export class CaseDeadline extends Error {
  readonly phase: "startup" | "compile" | "case";
  constructor(phase: "startup" | "compile" | "case") {
    super("Sandbox deadline exceeded");
    this.phase = phase;
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
  compileMs: number;
  wallMs: number;
  markers: number;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  let phase: "startup" | "compile" | "case" = "startup",
    count = 0,
    expired: CaseDeadline | undefined,
    first = 0,
    compilationMs = 0;
  let timer: ReturnType<typeof setTimeout>;
  const arm = (duration: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      expired = new CaseDeadline(phase);
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
        if (options.markers > 1) compilationMs = Math.max(0, performance.now() - first);
        phase = "case";
        arm(options.wallMs);
      } else {
        phase = "compile";
        arm(options.compileMs);
      }
    }
  };
  return {
    signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]),
    observe,
    deadline: () => expired,
    ready: () => count === options.markers,
    compilationMs: () => compilationMs,
    close: () => clearTimeout(timer),
  };
}
