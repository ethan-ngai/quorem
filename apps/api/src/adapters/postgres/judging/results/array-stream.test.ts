/** @file array-stream.test.ts @description Forward scans retain lossless values and release their source. @module judging */
import { describe, expect, it } from "vitest";
import { ResultArray } from "./array-stream.ts";

describe("result arrays", () => {
  it("reads sparse ordinals once across split strings and nested values", async () => {
    let reads = 0;
    async function* chunks() {
      for (const part of ['[{"n":9007199254740993},', '["x,', 'y",{}],', '{"n":3}]']) {
        reads++;
        yield part;
      }
    }
    const values = new ResultArray(chunks(), async () => {});
    expect(await (await values.at(0)).value()).toBe('{"n":9007199254740993}');
    expect(await (await values.at(2)).value()).toBe('{"n":3}');
    expect(reads).toBe(4);
    await expect(values.at(1)).rejects.toThrow("must advance");
    await values.close();
  });

  it("does not read ahead and closes a partially consumed source", async () => {
    let reads = 0;
    let closed = false;
    async function* chunks() {
      try {
        reads++;
        yield "[1,";
        reads++;
        yield "2]";
      } finally {
        closed = true;
      }
    }
    const values = new ResultArray(chunks(), async () => {});
    expect(await (await values.at(0)).value()).toBe("1");
    expect(reads).toBe(1);
    await values.close();
    expect(closed).toBe(true);
    expect(reads).toBe(1);
  });

  it("rejects a missing selected value", async () => {
    async function* chunks() {
      yield "[1]";
    }
    const values = new ResultArray(chunks(), async () => {});
    await expect(values.at(1)).rejects.toThrow("Invalid JSON stream");
    await values.close();
  });
});

it("reauthorizes each buffered ordinal before exposing it", async () => {
  let allowed = true;
  async function* chunks() {
    yield "[1,2]";
  }
  const values = new ResultArray(chunks(), async () => {
    if (!allowed) throw new Error("revoked or changed");
  });
  expect(await (await values.at(0)).value()).toBe("1");
  allowed = false;
  await expect(values.at(1)).rejects.toThrow("revoked or changed");
  await values.close();
});
