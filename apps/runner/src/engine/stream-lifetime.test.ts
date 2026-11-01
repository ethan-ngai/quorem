/// <reference types="node" />
/** @file stream-lifetime.test.ts @description Real file-stream cleanup after JSON projections. @module runner */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseSpans } from "./case-spans.ts";
import type { spoolInput } from "../checkpoints/input-spool.ts";

void test("large-span peeks and rejected projections close every real read stream", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quorem-stream-lifetime-"));
  const path = join(directory, "case.json");
  const streams: ReadStream[] = [];
  const assertClosed = async () => {
    await Promise.all(
      streams
        .filter((stream) => stream.destroyed && !stream.closed)
        .map((stream) => new Promise<void>((resolve) => stream.once("close", resolve))),
    );
    assert.equal(
      streams.every((stream) => stream.closed),
      true,
    );
  };
  const spool = {
    stream(start = 0, length?: number) {
      const stream = createReadStream(path, {
        start,
        ...(length === undefined ? {} : { end: start + length - 1 }),
      });
      streams.push(stream);
      return stream;
    },
  } as Awaited<ReturnType<typeof spoolInput>>;
  try {
    for (let i = 0; i < 3; i++) {
      await writeFile(path, JSON.stringify({ args: ["x".repeat(200000)], expected: [] }));
      const projection = await caseSpans(spool);
      for await (const _ of projection.args()) {
        /* consume projected input */
      }
      await assertClosed();
    }
    await writeFile(path, JSON.stringify({ args: { invalid: "x".repeat(200000) }, expected: [] }));
    const projection = await caseSpans(spool);
    await assert.rejects(async () => {
      for await (const _ of projection.args()) {
        /* rejected shape */
      }
    }, /Invalid case arguments/);
    await assertClosed();
    await writeFile(path, JSON.stringify({ unexpected: "x".repeat(200000) }));
    await assert.rejects(caseSpans(spool), /Invalid JSON object key/);
    await assertClosed();
  } finally {
    for (const stream of streams) stream.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
