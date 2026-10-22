import { describe, expect, it } from "vitest";
import {
  accountSetupSchema,
  emailInputSchema,
  emailSchema,
  passwordSchema,
  usernameSchema,
} from "@quorem/contracts/auth";

describe("shared registration validation", () => {
  it.each(["ab", "SomeUser", "some_user", "some-user", "some user", "用户", "a".repeat(31)])(
    "rejects disallowed username %s",
    (value) => {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    },
  );
  it("accepts lowercase letters/digits and normalizes valid email case", () => {
    expect(usernameSchema.parse("user123")).toBe("user123");
    expect(emailSchema.parse("User+test@Example.com")).toBe("user+test@example.com");
    expect(emailInputSchema.safeParse("a b@example.com").success).toBe(false);
    expect(emailSchema.safeParse("user@@example.com").success).toBe(false);
    expect(emailSchema.safeParse("user@localhost").success).toBe(false);
  });
  it("requires eight characters and a punctuation/symbol character, not whitespace", () => {
    expect(passwordSchema.safeParse("abc123!").success).toBe(false);
    expect(passwordSchema.safeParse("abc12345").success).toBe(false);
    expect(passwordSchema.safeParse("abc1234 ").success).toBe(false);
    expect(passwordSchema.parse("abc1234!")).toBe("abc1234!");
  });
  it("keeps optional name empty and trims a supplied name without copying username", () => {
    const input = { email: "person@example.test", username: "person123", password: "abc1234!" };
    expect(accountSetupSchema.parse(input).name).toBe("");
    expect(accountSetupSchema.parse({ ...input, name: "  Pat Example  " }).name).toBe(
      "Pat Example",
    );
    expect(accountSetupSchema.safeParse({ ...input, name: "Bad\nName" }).success).toBe(false);
  });
});
