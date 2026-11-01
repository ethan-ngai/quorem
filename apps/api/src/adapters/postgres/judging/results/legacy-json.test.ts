/** @file legacy-json.test.ts @description Incremental lexical boundary tests. @module judging */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LegacyJsonReader } from "./legacy-json.ts";
void test("scans escaped nested values across input chunks", async () => {
  async function* source() {
    yield '{"x":[{"v":"a\\';
    yield '"b"},';
    yield "9007199254740993]}";
  }
  const reader = new LegacyJsonReader(source());
  await reader.expect("{");
  assert.equal(await reader.value(), '"x"');
  await reader.expect(":");
  await reader.expect("[");
  const parts: string[] = [];
  for await (const part of reader.valueChunks()) parts.push(part);
  assert.equal(parts.join(""), '{"v":"a\\"b"}');
  assert.ok(parts.length > 1);
  await reader.expect(",");
  assert.equal(await reader.value(), "9007199254740993");
  await reader.expect("]");
  await reader.expect("}");
  assert.equal(await reader.peek(), "");
});
void test("rejects a truncated nested value", async () => {
  async function* source() {
    yield '{"x":"';
    yield "unfinished";
  }
  const reader = new LegacyJsonReader(source());
  await assert.rejects(reader.value(), /Truncated/);
});
void test("tracks source byte ranges across multibyte UTF-8", async () => {
  async function* source() {
    yield '[ "🐈';
    yield '\\u0000", 9]';
  }
  const reader = new LegacyJsonReader(source());
  await reader.expect("[");
  await reader.peek();
  const start = reader.byteOffset;
  for await (const _ of reader.valueChunks()) {
  }
  assert.equal(start, 2);
  assert.equal(reader.byteOffset - start, new TextEncoder().encode('"🐈\\u0000"').byteLength);
  await reader.expect(",");
  assert.equal(await reader.value(), "9");
  await reader.expect("]");
});
