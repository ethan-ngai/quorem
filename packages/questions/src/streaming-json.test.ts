import { describe, expect, it } from "vitest";
import {
  decodeUtf8Chunks,
  encodeJsonStringChunks,
  readAllowedObjectSpans,
  StreamingJsonReader,
} from "./streaming-json.ts";
import { stringifyLosslessJson } from "./json.ts";
async function parse(bytes: Uint8Array, widths = 1) {
  async function* chunks() {
    for (let i = 0; i < bytes.length; i += widths) yield bytes.subarray(i, i + widths);
  }
  return readAllowedObjectSpans(
    new StreamingJsonReader(decodeUtf8Chunks(chunks())[Symbol.asyncIterator]()),
    new Set(["args", "calls", "expected"]),
  );
}
describe("bounded case field spans", () => {
  it("preserves UTF-8 byte offsets and raw lossless values across chunk boundaries", async () => {
    const raw = '{"args":["λ\\u0000",9007199254740993],"expected":{"v":1e309}}',
      bytes = new TextEncoder().encode(raw),
      spans = await parse(bytes, 2);
    const text = (name: string) => {
      const s = spans.get(name)!;
      return new TextDecoder().decode(bytes.subarray(s.start, s.start + s.length));
    };
    expect(text("args")).toBe('["λ\\u0000",9007199254740993]');
    expect(text("expected")).toBe('{"v":1e309}');
  });
  it.each([
    '{"args":1,"args":2}',
    '{"unknown":1}',
    '{"args":1,}',
    '{"args":1}true',
    '{"args":[1}',
    '{"args":',
  ])("rejects invalid object structure: %s", async (raw) => {
    await expect(parse(new TextEncoder().encode(raw))).rejects.toThrow();
  });
  it("rejects malformed UTF-8", async () => {
    await expect(
      parse(new Uint8Array([123, 34, 97, 114, 103, 115, 34, 58, 34, 0xff, 34, 125])),
    ).rejects.toThrow();
  });
  it("encodes text as the same canonical JSON string across UTF-8 chunk boundaries", async () => {
    const value = 'hello <λ>&\u0000\n"\\ 🐈';
    const bytes = new TextEncoder().encode(value);
    async function* chunks() {
      for (const byte of bytes) yield new Uint8Array([byte]);
    }
    const parts: Uint8Array[] = [];
    for await (const part of encodeJsonStringChunks(chunks())) parts.push(part);
    const length = parts.reduce((n, p) => n + p.length, 0),
      out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    expect(new TextDecoder().decode(out)).toBe(stringifyLosslessJson(value));
  });
});
