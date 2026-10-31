/** @file case-spans.ts @description Expected-free streamed case projection. @module runner */
import {
  decodeUtf8Chunks,
  readAllowedObjectSpans,
  StreamingJsonReader,
  type JsonSpan,
} from "@quorem/questions";
import type { spoolInput } from "../checkpoints/input-spool.ts";
type Spool = Awaited<ReturnType<typeof spoolInput>>;
const encoder = new TextEncoder();
const fieldNames = new Set(["args", "calls", "expected"]);
const callNames = new Set(["methodName", "args", "expected"]);
const reader = (spool: Spool, span: JsonSpan) =>
  new StreamingJsonReader(
    decodeUtf8Chunks(spool.stream(span.start, span.length))[Symbol.asyncIterator](),
  );
async function kind(spool: Spool, span: JsonSpan): Promise<string> {
  return reader(spool, span).peek();
}
async function* raw(spool: Spool, span: JsonSpan): AsyncGenerator<Uint8Array> {
  for await (const part of spool.stream(span.start, span.length)) yield part as Uint8Array;
}
async function* arrayOrEmpty(spool: Spool, span?: JsonSpan): AsyncGenerator<Uint8Array> {
  if (!span || (await kind(spool, span)) === "n") {
    yield encoder.encode("[]");
    return;
  }
  if ((await kind(spool, span)) !== "[") throw new Error("Invalid case arguments");
  yield* raw(spool, span);
}
/** Case input is already SHA-verified and grammar-validated by the input owner. */
export async function caseSpans(spool: Spool) {
  const top = await readAllowedObjectSpans(
    new StreamingJsonReader(decodeUtf8Chunks(spool.stream())[Symbol.asyncIterator]()),
    fieldNames,
  );
  const calls: Map<string, JsonSpan>[] = [],
    callsSpan = top.get("calls");
  if (callsSpan && (await kind(spool, callsSpan)) !== "n") {
    const input = reader(spool, callsSpan);
    await input.expect("[");
    if ((await input.peek()) !== "]")
      for (;;) {
        if (calls.length >= 100) throw new Error("Invalid case sequence");
        const fields = await readAllowedObjectSpans(input, callNames, false);
        const absolute = new Map<string, JsonSpan>();
        for (const [name, span] of fields)
          absolute.set(name, { start: callsSpan.start + span.start, length: span.length });
        calls.push(absolute);
        if ((await input.peek()) === "]") break;
        await input.expect(",");
        if ((await input.peek()) === "]") throw new Error("Invalid case sequence");
      }
    await input.expect("]");
    if (await input.peek()) throw new Error("Invalid case sequence");
  }
  return {
    expected: top.get("expected"),
    calls,
    args: () => arrayOrEmpty(spool, top.get("args")),
    async *requestCalls(): AsyncGenerator<Uint8Array> {
      yield encoder.encode("[");
      for (let i = 0; i < calls.length; i++) {
        if (i) yield encoder.encode(",");
        yield encoder.encode('{"methodName":');
        const name = calls[i].get("methodName");
        if (!name || (await kind(spool, name)) !== '"') throw new Error("Invalid method name");
        yield* raw(spool, name);
        yield encoder.encode(',"args":');
        yield* arrayOrEmpty(spool, calls[i].get("args"));
        yield encoder.encode("}");
      }
      yield encoder.encode("]");
    },
  };
}
