/** @file framing.test.ts @description Fragmentation and framing bounds. @module language */
import assert from "node:assert/strict";
import test from "node:test";
import { encodeFrame, FrameDecoder } from "./framing.ts";

void test("multibyte messages survive fragmented and coalesced frames", () => {
  const messages = ['{"text":"λ"}', '{"id":2}'];
  const bytes = Buffer.concat(messages.map(encodeFrame));
  const decoder = new FrameDecoder();
  const decoded: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 3)
    decoded.push(...decoder.push(bytes.subarray(offset, offset + 3)));
  assert.deepEqual(decoded, messages);
});

void test("oversized or ambiguous headers are rejected before buffering bodies", () => {
  assert.throws(() => new FrameDecoder().push(Buffer.from("Content-Length: 3000000\r\n\r\n")));
  assert.throws(() =>
    new FrameDecoder().push(Buffer.from("Content-Length: 1\r\nContent-Length: 1\r\n\r\nx")),
  );
  assert.throws(() => new FrameDecoder().push(Buffer.alloc(4097)));
});

void test("invalid UTF-8, JSON, malformed headers and truncated output fail closed", () => {
  for (const data of [
    Buffer.from("Content-Length: 1\r\n\r\n{"),
    Buffer.from("Malformed\r\nContent-Length: 2\r\n\r\n{}"),
    Buffer.concat([Buffer.from("Content-Length: 1\r\n\r\n"), Buffer.from([255])]),
  ])
    assert.throws(() => new FrameDecoder().push(data));
  const decoder = new FrameDecoder();
  decoder.push(Buffer.from("Content-Length: 4\r\n\r\n{"));
  assert.throws(() => decoder.finish());
});
