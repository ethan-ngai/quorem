/** @file metadata-spans.ts @description Bounded field references in verified runner metadata. @module runner */
import {
  decodeUtf8Chunks,
  readAllowedObjectSpans,
  StreamingJsonReader,
  withStreamingJsonReader,
  type StreamingJsonSpan,
} from "@quorem/questions";
import type { spoolInput } from "../checkpoints/input-spool.ts";
type Spool = Awaited<ReturnType<typeof spoolInput>>;
const topNames = new Set([
  "id",
  "slug",
  "version",
  "title",
  "difficulty",
  "companies",
  "leetcodeId",
  "tags",
  "statementMarkdown",
  "constraints",
  "signature",
  "limits",
  "sql",
  "odyssey",
  "languages",
  "starterSource",
  "runtimeRevision",
]);
const levelNames = new Set(["title", "statementMarkdown", "methods"]);
const methodNames = new Set([
  "className",
  "methodName",
  "parameters",
  "returnType",
  "outputOrder",
  "description",
  "returns",
  "throws",
]);
const reader = (spool: Spool, span: StreamingJsonSpan) =>
  new StreamingJsonReader(
    decodeUtf8Chunks(spool.stream(span.start, span.length))[Symbol.asyncIterator](),
  );
const absolute = (base: number, span: StreamingJsonSpan): StreamingJsonSpan => ({
  start: base + span.start,
  length: span.length,
});
async function methodName(spool: Spool, span: StreamingJsonSpan): Promise<string> {
  if (span.length > 482) throw new Error("Invalid method name");
  const parts: Uint8Array[] = [];
  for await (const chunk of spool.stream(span.start, span.length)) parts.push(chunk as Uint8Array);
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
  );
  if (typeof value !== "string" || value.length > 80 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
    throw new Error("Invalid method name");
  return value;
}
/** The blob is verified and its JSON grammar was validated by the publisher/backfill owner. */
export async function metadataSpans(spool: Spool, level: number | null) {
  const fields = await readAllowedObjectSpans(
    new StreamingJsonReader(decodeUtf8Chunks(spool.stream())[Symbol.asyncIterator]()),
    topNames,
  );
  const signature = fields.get("signature");
  if (!signature) throw new Error("Missing signature");
  const methods: { name: string; span: StreamingJsonSpan }[] = [],
    names = new Set<string>(),
    odyssey = fields.get("odyssey");
  if (
    odyssey &&
    (await withStreamingJsonReader(reader(spool, odyssey), (input) => input.peek())) !== "n"
  ) {
    if (!Number.isInteger(level) || level! < 1 || level! > 8)
      throw new Error("Invalid Odyssey level");
    const odysseyFields = await readAllowedObjectSpans(reader(spool, odyssey), new Set(["levels"]));
    const levels = odysseyFields.get("levels");
    if (!levels) throw new Error("Missing Odyssey levels");
    const levelsAbsolute = absolute(odyssey.start, levels),
      input = reader(spool, levelsAbsolute);
    await withStreamingJsonReader(input, async () => {
      await input.expect("[");
      let stage = 0;
      if ((await input.peek()) !== "]")
        for (;;) {
          stage++;
          if (stage > 8) throw new Error("Invalid Odyssey levels");
          const fields = await readAllowedObjectSpans(input, levelNames, false),
            rawMethods = fields.get("methods");
          if (!rawMethods) throw new Error("Missing Odyssey methods");
          if (stage <= level!) {
            const methodsAbsolute = absolute(levelsAbsolute.start, rawMethods),
              stream = reader(spool, methodsAbsolute);
            try {
              let count = 0;
              await stream.expect("[");
              if ((await stream.peek()) !== "]")
                for (;;) {
                  if (++count > 16) throw new Error("Invalid Odyssey methods");
                  await stream.peek();
                  const start = stream.byteOffset;
                  const item = await readAllowedObjectSpans(stream, methodNames, false),
                    nameSpan = item.get("methodName");
                  if (!nameSpan) throw new Error("Missing method name");
                  const name = await methodName(spool, absolute(methodsAbsolute.start, nameSpan));
                  if (names.has(name)) throw new Error("Duplicate method name");
                  names.add(name);
                  methods.push({
                    name,
                    span: {
                      start: methodsAbsolute.start + start,
                      length: stream.byteOffset - start,
                    },
                  });
                  if ((await stream.peek()) === "]") break;
                  await stream.expect(",");
                  if ((await stream.peek()) === "]") throw new Error("Invalid Odyssey methods");
                }
              await stream.expect("]");
              if (await stream.peek()) throw new Error("Invalid Odyssey methods");
            } finally {
              await stream.close();
            }
          }
          if ((await input.peek()) === "]") break;
          await input.expect(",");
          if ((await input.peek()) === "]") throw new Error("Invalid Odyssey levels");
        }
      await input.expect("]");
      if ((await input.peek()) || stage < level!) throw new Error("Invalid Odyssey levels");
    });
  }
  return { signature, sql: fields.get("sql"), methods };
}
