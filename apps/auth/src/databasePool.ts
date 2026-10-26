// Every elastic replica has a finite connection budget and releases idle sessions.
export function databasePoolOptions(env: Record<string, string | undefined>) {
  const raw = env.AUTH_DATABASE_MAX_CONNS;
  const max = raw === undefined || raw === "" ? 4 : Number(raw);
  if (!Number.isInteger(max) || max < 1 || max > 64) {
    throw new Error("AUTH_DATABASE_MAX_CONNS must be between 1 and 64");
  }
  return { max, min: 0, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 };
}
