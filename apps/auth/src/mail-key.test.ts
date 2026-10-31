import { describe, expect, it } from "vitest";
import { mailIntentKey } from "./mail-key.ts";
import { composeAuth } from "./composition.ts";
import type { configuration } from "./config.ts";

describe("mail intent key", () => {
  it("requires an explicit 32-byte hexadecimal key", () => {
    for (const value of [undefined, "", "a".repeat(62), "z".repeat(64), "a".repeat(66)])
      expect(() => mailIntentKey(value)).toThrow(
        "AUTH_MAIL_INTENT_KEY must be 32 bytes encoded as hex",
      );
    expect(mailIntentKey("0123456789abcdef".repeat(4))).toHaveLength(32);
  });
  it("fails composition when a selected transport or key is missing", () => {
    const config = { mail: { driver: "cloudflare" }, registration: true } as ReturnType<
      typeof configuration
    >;
    const run: Parameters<typeof composeAuth>[0]["run"] = async () => {
      throw new Error("unused");
    };
    expect(() => composeAuth({ config, run })).toThrow("Configured email delivery requires");
    expect(() => composeAuth({ config, run, transport: async () => {} })).toThrow(
      "Configured email delivery requires",
    );
  });
});
