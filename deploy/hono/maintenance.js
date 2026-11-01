/** Public API maintenance boundary; static Pages remains on its existing route. */
export default {
  queue(batch) {
    for (const message of batch.messages) message.retry({ delaySeconds: 30 });
  },
  fetch() {
    return Response.json(
      { error: "maintenance", runtime: "hono" },
      {
        status: 503,
        headers: {
          "retry-after": "30",
          "cache-control": "no-store",
          "x-quorem-runtime": "hono-maintenance",
        },
      },
    );
  },
};
