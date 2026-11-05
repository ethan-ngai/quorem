/** Private aggregate timings; arguments and results never enter telemetry. */
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
