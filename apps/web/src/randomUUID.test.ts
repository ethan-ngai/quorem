/** @file randomUUID.test.ts @description UUID compatibility across browser security contexts. @module web */
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "./randomUUID";

afterEach(() => vi.unstubAllGlobals());

describe("randomUUID", () => {
  it("uses native UUIDs when available", () => {
    const native = vi.fn(() => "native-uuid");
    vi.stubGlobal("crypto", { randomUUID: native });
    expect(randomUUID()).toBe("native-uuid");
    expect(native).toHaveBeenCalledOnce();
  });

  it("sets UUID version and variant bits without native randomUUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0xff));
    vi.stubGlobal("crypto", { getRandomValues });
    expect(randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("generates distinct valid UUIDs using only getRandomValues", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const ids = Array.from({ length: 100 }, () => randomUUID());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
