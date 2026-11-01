/** @file stream.ts @description Pull-driven JSON response chunks. @module judging */
/** A pull advances at most one source chunk; cancellation closes its iterator. */
export function jsonStream(source: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator](),
    encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}
