/** @file scheduling.ts @description Bounded judging concurrency shared by runtime and sandbox owners. @module execution */
export const CASE_LANES = 20;
export const CASE_WINDOW_BYTES = 8 * 1024 * 1024;
export const CASE_SCOPE_REVISION = "case-lanes-v3";
export const JUDGING_DEFAULTS = Object.freeze({ slots: 8, caseLanes: 10, sliceMs: 2000 });
/** Reject capacity changes outside the supported sandbox and drain bounds. */
export function judgingCapacity(env: Record<string, string | undefined>) {
  const integer = (name: string, fallback: number, max: number) => {
    const raw = env[name] ?? String(fallback);
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max)
      throw new Error(`Invalid ${name}`);
    return Number(raw);
  };
  return {
    slots: integer("JUDGING_SLOTS", JUDGING_DEFAULTS.slots, 8),
    caseLanes: integer("JUDGING_CASE_LANES", JUDGING_DEFAULTS.caseLanes, CASE_LANES),
    sliceMs: integer("JUDGING_SLICE_MS", JUDGING_DEFAULTS.sliceMs, 50000),
  };
}
