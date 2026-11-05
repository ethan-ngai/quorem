/** Request-confined connections for fully materialized private judging operations. */
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
type Run = <T>(operation: (scope: ConnectionScope) => Promise<T>) => Promise<T>;

/** Reuse two connections inside one invocation; never retain clients across requests. */
export async function withJudgingConnections<T>(
  connectionString: string,
  signal: AbortSignal,
  operation: (run: Run) => Promise<T>,
): Promise<T> {
  const pool = createNodePool({
    connectionString,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 240000,
    onIdleError: () => {},
  });
  try {
    return await operation((callback) =>
      withNodeConnection(pool, { lifetimeMs: 30000, signal }, callback),
    );
  } finally {
    await pool.end();
  }
}
