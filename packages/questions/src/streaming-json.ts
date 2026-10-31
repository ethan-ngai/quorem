/** @file streaming-json.ts @description Incremental JSON value boundaries and byte offsets. @module questions */
import { stringifyLosslessJson } from "./json.ts";
/** One token is buffered at a time; callers split arrays into individual values. */
export class StreamingJsonReader {
  private buffer = "";
  private index = 0;
  private done = false;
  private offset = 0;
  get byteOffset(): number {
    return this.offset;
  }
  private consumed(part: string): string {
    this.offset += new TextEncoder().encode(part).byteLength;
    return part;
  }
  private readonly chunks: AsyncIterator<string>;
  constructor(chunks: AsyncIterator<string>) {
    this.chunks = chunks;
  }
  private async ensure(): Promise<boolean> {
    while (this.index === this.buffer.length && !this.done) {
      const next = await this.chunks.next();
      this.done = !!next.done;
      this.buffer = next.value ?? "";
      this.index = 0;
    }
    return this.index < this.buffer.length;
  }
  async peek(): Promise<string> {
    while (await this.ensure()) {
      const char = this.buffer[this.index];
      if (!/\s/.test(char)) return char;
      this.index++;
      this.offset++;
    }
    return "";
  }
  async expect(expected: string): Promise<void> {
    if ((await this.peek()) !== expected) throw new Error("Invalid JSON stream");
    this.index++;
    this.offset++;
  }
  async *valueChunks(): AsyncGenerator<string> {
    const first = await this.peek();
    if (!first) throw new Error("Truncated JSON stream");
    const composite = first === "{" || first === "[",
      quoted = first === '"';
    let depth = 0,
      inString = false,
      escaped = false,
      started = false;
    while (await this.ensure()) {
      const start = this.index;
      while (this.index < this.buffer.length) {
        const c = this.buffer[this.index];
        if (!started) {
          started = true;
          if (composite) depth = 1;
          if (quoted) inString = true;
          this.index++;
          continue;
        }
        if (inString) {
          this.index++;
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') {
            inString = false;
            if (quoted && !composite) {
              yield this.consumed(this.buffer.slice(start, this.index));
              return;
            }
          }
          continue;
        }
        if (c === '"') {
          inString = true;
          this.index++;
          continue;
        }
        if (composite && (c === "{" || c === "[")) {
          depth++;
          this.index++;
          continue;
        }
        if (composite && (c === "}" || c === "]")) {
          depth--;
          this.index++;
          if (!depth) {
            yield this.consumed(this.buffer.slice(start, this.index));
            return;
          }
          continue;
        }
        if (!composite && (c === "," || c === "]" || c === "}" || /\s/.test(c))) {
          const part = this.buffer.slice(start, this.index);
          if (part) yield this.consumed(part);
          return;
        }
        this.index++;
      }
      const part = this.buffer.slice(start, this.index);
      if (part) yield this.consumed(part);
    }
    if (!composite && !quoted && started) return;
    throw new Error("Truncated JSON stream");
  }
  async value(capture = true): Promise<string> {
    const parts: string[] = [];
    for await (const part of this.valueChunks()) if (capture) parts.push(part);
    return parts.join("");
  }
}

/** Decode each chunk without accepting malformed or incomplete UTF-8. */
export async function* decodeUtf8Chunks(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of chunks) {
    const decoded = decoder.decode(chunk, { stream: true });
    if (decoded) yield decoded;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}
export interface JsonSpan {
  readonly start: number;
  readonly length: number;
}
/**
 * Scan a previously grammar-validated object without retaining values. Unknown and duplicate
 * keys fail closed; the whitelist bounds key buffering without limiting value size.
 */
export async function readAllowedObjectSpans(
  input: StreamingJsonReader,
  allowed: ReadonlySet<string>,
  requireEnd = true,
): Promise<Map<string, JsonSpan>> {
  const result = new Map<string, JsonSpan>();
  const keyLimit = Math.max(0, ...Array.from(allowed, (key) => key.length)) * 6 + 2;
  await input.expect("{");
  if ((await input.peek()) !== "}")
    for (;;) {
      let encoded = "";
      for await (const fragment of input.valueChunks()) {
        encoded += fragment;
        if (encoded.length > keyLimit) throw new Error("Invalid JSON object key");
      }
      let key: unknown;
      try {
        key = JSON.parse(encoded);
      } catch {
        throw new Error("Invalid JSON object key");
      }
      if (typeof key !== "string" || !allowed.has(key) || result.has(key))
        throw new Error("Invalid JSON object key");
      await input.expect(":");
      await input.peek();
      const start = input.byteOffset;
      for await (const _ of input.valueChunks()) {
        /* retain only byte ranges */
      }
      result.set(key, { start, length: input.byteOffset - start });
      const separator = await input.peek();
      if (separator === "}") break;
      await input.expect(",");
      if ((await input.peek()) === "}") throw new Error("Invalid JSON object separator");
    }
  await input.expect("}");
  if (requireEnd && (await input.peek())) throw new Error("Trailing JSON input");
  return result;
}
/** Encode verified UTF-8 text as one canonical JSON string without materializing it. */
export async function* encodeJsonStringChunks(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  yield encoder.encode('"');
  for await (const part of decodeUtf8Chunks(chunks)) {
    const quoted = stringifyLosslessJson(part);
    yield encoder.encode(quoted.slice(1, -1));
  }
  yield encoder.encode('"');
}
