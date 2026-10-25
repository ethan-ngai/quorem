import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "./sha256";

afterEach(() => vi.unstubAllGlobals());

describe("private fingerprints on HTTP LAN origins", () => {
  it("matches SHA-256 vectors without Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256("abc\n")).not.toBe(await sha256("abc"));
  });
});
