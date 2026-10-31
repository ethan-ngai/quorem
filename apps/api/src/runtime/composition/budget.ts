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
      let terminated = false;
      let cancellation: Promise<void> | undefined;
      const finish = () => {
        release();
        if (!unlocked) {
          unlocked = true;
          reader.releaseLock();
        }
      };
      const cancel = (reason: unknown) => {
        cancellation ??= reader.cancel(reason).finally(finish);
        return cancellation;
      };
      const body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            abort = () => {
              if (terminated) return;
              terminated = true;
              controller.close();
              void cancel(request.signal.reason).catch(() => {});
            };
            if (request.signal.aborted) abort();
            else request.signal.addEventListener("abort", abort, { once: true });
          },
          async pull(controller) {
            if (terminated) return;
            try {
              const chunk = await reader.read();
              if (terminated) return;
              if (chunk.done) {
                terminated = true;
                finish();
                controller.close();
              } else controller.enqueue(chunk.value);
            } catch (error) {
              if (terminated) return;
              terminated = true;
              finish();
              controller.error(error);
            }
          },
          async cancel(reason) {
            if (terminated) return cancellation;
            terminated = true;
            await cancel(reason);
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
