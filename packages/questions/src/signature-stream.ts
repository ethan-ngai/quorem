/** @file signature-stream.ts @description Bounded comparison policy from a signature span. @module questions */
import {
  decodeUtf8Chunks,
  readAllowedObjectSpans,
  StreamingJsonReader,
  type JsonSpan,
} from "./streaming-json.ts";
import { validQuestionType } from "./signature.ts";
export interface JsonRangeSource {
  stream(start: number, length: number): AsyncIterable<Uint8Array>;
}
type Spool = JsonRangeSource;
type StreamingJsonSpan = JsonSpan;
const names = new Set([
  "className",
  "methodName",
  "parameters",
  "returnType",
  "outputOrder",
  "description",
  "returns",
  "throws",
]);
async function stringValue(
  spool: Spool,
  span: StreamingJsonSpan,
  maxCharacters: number,
): Promise<string> {
  // A JSON escaped character needs at most six ASCII bytes; the semantic bound comes from the signature grammar.
  if (span.length > maxCharacters * 6 + 2) throw new Error("Invalid signature value");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of spool.stream(span.start, span.length)) {
    total += chunk.length;
    if (total > span.length) throw new Error("Invalid signature value");
    chunks.push(chunk);
  }
  if (total !== span.length) throw new Error("Invalid signature value");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof value !== "string" || value.length > maxCharacters)
    throw new Error("Invalid signature value");
  return value;
}
/** Descriptions and parameters remain as spans; comparison needs only return type and order. */
export async function signaturePolicy(
  spool: Spool,
  span: StreamingJsonSpan,
  allowVoid = false,
): Promise<{ returnType: string; outputOrder: "ordered" | "unordered" }> {
  const input = new StreamingJsonReader(
    decodeUtf8Chunks(spool.stream(span.start, span.length))[Symbol.asyncIterator](),
  );
  const fields = await readAllowedObjectSpans(input, names);
  const result = fields.get("returnType");
  if (!result) throw new Error("Missing return type");
  const returnType = await stringValue(
    spool,
    { start: span.start + result.start, length: result.length },
    1008,
  );
  if (!(allowVoid && returnType === "void") && !validQuestionType(returnType))
    throw new Error("Invalid return type");
  const order = fields.get("outputOrder");
  const outputOrder = order
    ? await stringValue(spool, { start: span.start + order.start, length: order.length }, 9)
    : "ordered";
  if (outputOrder !== "ordered" && outputOrder !== "unordered")
    throw new Error("Invalid output order");
  if (outputOrder === "unordered" && !/^(list|array)</.test(returnType))
    throw new Error("Invalid output order");
  return { returnType, outputOrder };
}
