import { describe, expect, it } from "vitest";
import { decodeUtf8Chunks, readAllowedObjectSpans, StreamingJsonReader } from "./streaming-json.ts";
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
});
