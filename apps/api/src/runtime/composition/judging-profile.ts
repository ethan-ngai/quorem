/** Private aggregate timings; arguments and results never enter telemetry. */
import type { ConnectionScope } from "@quorem/database/core";
type Run = <T>(operation: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export function judgingProfile() {
  const started = performance.now();
  const metrics: Record<string, { calls: number; totalMs: number; maxMs: number }> = {};
  const record = (name: string, elapsed: number) => {
    const ms = Math.max(0, Math.round(elapsed));
    const metric = (metrics[name] ??= { calls: 0, totalMs: 0, maxMs: 0 });
    metric.calls++;
    metric.totalMs += ms;
    metric.maxMs = Math.max(metric.maxMs, ms);
  };
  return {
    record,
    connection(run: Run): Run {
      return (operation) => {
        const began = performance.now();
        let finished: number | undefined;
        return run(async (scope) => {
          const opened = performance.now();
          record("postgres.open", opened - began);
          try {
            return await operation(scope);
          } finally {
            finished = performance.now();
            record("postgres.work", finished - opened);
          }
        }).finally(() => {
          if (finished !== undefined) record("postgres.close", performance.now() - finished);
        });
      };
    },
    wrap<T extends object>(owner: T, prefix: string): T {
      return Object.fromEntries(
        Object.entries(owner).map(([name, value]) => [
          name,
          typeof value !== "function"
            ? value
            : async (...args: unknown[]) => {
                const start = performance.now();
                try {
                  return await Reflect.apply(value, owner, args);
                } finally {
                  record(`${prefix}.${name}`, performance.now() - start);
                }
              },
        ]),
      ) as T;
    },
    header() {
      return JSON.stringify({ elapsedMs: Math.round(performance.now() - started), metrics });
    },
  };
}
