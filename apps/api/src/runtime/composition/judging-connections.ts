/** Request-confined judging connections, including streamed public result reads. */
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
type Run = <T>(operation: (scope: ConnectionScope) => Promise<T>) => Promise<T>;

/** Reserve headroom for private HTTP calls; never share sockets across invocations. */
function connections(connectionString: string, signal: AbortSignal) {
  const pool = createNodePool({
    connectionString,
    max: 4,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 240000,
    onIdleError: () => {},
  });
  let closing: Promise<void> | undefined;
  return {
    run: ((callback) => withNodeConnection(pool, { lifetimeMs: 30000, signal }, callback)) as Run,
    close: () => (closing ??= pool.end()),
  };
}
export async function withJudgingConnections<T>(
  connectionString: string,
  signal: AbortSignal,
  operation: (run: Run) => Promise<T>,
): Promise<T> {
  const owned = connections(connectionString, signal);
  try {
    return await operation(owned.run);
  } finally {
    await owned.close();
  }
}
/** Result pages read after headers; retain ownership until EOF, cancellation or failure. */
export async function withJudgingResponse(
  connectionString: string,
  signal: AbortSignal,
  operation: (run: Run) => Promise<Response>,
  onClose?: () => void,
): Promise<Response> {
  const owned = connections(connectionString, signal);
  let finalized: Promise<void> | undefined;
  const finish = () => (finalized ??= owned.close().finally(onClose));
  try {
    signal.throwIfAborted();
    const response = await operation(owned.run);
    if (!response.body) {
      await finish();
      return response;
    }
    const reader = response.body.getReader();
    let settled = false;
    let output: ReadableStreamDefaultController<Uint8Array>;
    const close = () => {
      signal.removeEventListener("abort", abort);
      return finish();
    };
    const cancel = async (reason: unknown) => {
      if (settled) return close();
      settled = true;
      try {
        await reader.cancel(reason);
      } finally {
        await close();
      }
    };
    const abort = () => {
      void cancel(signal.reason).then(
        () => output.error(signal.reason),
        (error) => output.error(error),
      );
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          output = controller;
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        },
        async pull(controller) {
          if (settled) return;
          try {
            const next = await reader.read();
            if (settled) return;
            if (next.done) {
              settled = true;
              await close();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            if (settled) return;
            settled = true;
            await close();
            controller.error(error);
          }
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    await finish();
    throw error;
  }
}
