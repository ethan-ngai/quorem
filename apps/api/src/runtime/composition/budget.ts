/** @file budget.ts @description Per-runtime HTTP concurrency with stream lifetime fencing. @module runtime */
export function requestBudget(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid request limit");
  let active = 0;
  return async (request: Request, next: () => Promise<Response>): Promise<Response> => {
    if (active >= limit) return unavailable();
    active++;
    let released = false;
    let abort: (() => void) | undefined;
    const release = () => {
      if (!released) {
        released = true;
        if (abort) request.signal.removeEventListener("abort", abort);
        active--;
      }
    };
    try {
      const response = await next();
      if (!response.body || request.method === "HEAD") {
        release();
        return response;
      }
      const reader = response.body.getReader();
      let unlocked = false;
      const finish = () => {
        release();
        if (!unlocked) {
          unlocked = true;
          reader.releaseLock();
        }
      };
      abort = () => {
        void reader
          .cancel(request.signal.reason)
          .catch(() => {})
          .finally(finish);
      };
      if (request.signal.aborted) abort();
      else request.signal.addEventListener("abort", abort, { once: true });
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                finish();
                controller.close();
              } else controller.enqueue(chunk.value);
            } catch (error) {
              finish();
              controller.error(error);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              finish();
            }
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, response);
    } catch (error) {
      release();
      throw error;
    }
  };
}

/** Preserve the shared error envelope when runtime composition is unavailable. */
export function unavailable(): Response {
  const requestId = crypto.randomUUID();
  return new Response(
    JSON.stringify({
      error: { code: "temporarily_unavailable", message: "Service unavailable", requestId },
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "retry-after": "1",
        "x-request-id": requestId,
      },
    },
  );
}
