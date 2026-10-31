import { describe, expect, it } from "vitest";
import { signaturePolicy } from "./signature-stream.ts";
function source(raw: string) {
  const bytes = new TextEncoder().encode(raw);
  return {
    bytes,
    stream: async function* (start: number, length: number) {
      const end = start + length;
      for (let offset = start; offset < end; offset += 1024)
        yield bytes.subarray(offset, Math.min(end, offset + 1024));
    },
  };
}
describe("streaming signature policy", () => {
  it("reads bounded return policy without retaining large documentation", async () => {
    const input = source(
      JSON.stringify({
        returnType: "list<int>",
        outputOrder: "unordered",
        description: "x".repeat(200000),
      }),
    );
    await expect(signaturePolicy(input, { start: 0, length: input.bytes.length })).resolves.toEqual(
      { returnType: "list<int>", outputOrder: "unordered" },
    );
  });
  it("rejects invalid types, ordering and oversized scalar encodings", async () => {
    for (const raw of [
      '{"returnType":"unknown"}',
      '{"returnType":"str","outputOrder":"unordered"}',
      `{"returnType":"${"x".repeat(7000)}"}`,
    ]) {
      const input = source(raw);
      await expect(
        signaturePolicy(input, { start: 0, length: input.bytes.length }),
      ).rejects.toThrow();
    }
  });
});
