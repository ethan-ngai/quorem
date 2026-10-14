import { describe, expect, it } from "vitest";
import { signInReferral } from "./signInReferral";

describe("sign-in back referral", () => {
  const origin = "https://quorem.test";
  it("preserves explicit referring page filters across canonical login", () => {
    expect(signInReferral("?returnTo=%2Fpractice%3Ftopic%3Darrays", "", origin)).toBe(
      "/practice?topic=arrays",
    );
    expect(signInReferral("?returnTo=%2Fmatch%2Fabc", "", origin)).toBe("/match/abc");
  });
  it("uses a same-origin page referral, including home", () => {
    expect(signInReferral("", `${origin}/`, origin)).toBe("/");
    expect(signInReferral("", `${origin}/practice?q=tree`, origin)).toBe("/practice?q=tree");
  });
  it("cancels pending match creation while preserving the referring workspace", () => {
    expect(signInReferral("?returnTo=%2Fpractice%3Fcreate%3Dmatch%26q%3Dtree", "", origin)).toBe(
      "/practice?q=tree",
    );
    expect(signInReferral("", `${origin}/practice?create=match&q=tree`, origin)).toBe(
      "/practice?q=tree",
    );
    expect(
      signInReferral(
        "?returnTo=%2Fpractice%3Fcreate%3Dmatch&backTo=%2Fpractice%2Fsplit-load",
        "",
        origin,
      ),
    ).toBe("/practice/split-load");
  });
  it("hides on direct, external or auth-only arrivals", () => {
    expect(signInReferral("", "", origin)).toBeNull();
    expect(signInReferral("", "https://other.test/practice", origin)).toBeNull();
    expect(signInReferral("", `${origin}/login`, origin)).toBeNull();
    for (const path of ["//other.test", "/login", "/practice\\other", "/practice\n"])
      expect(signInReferral(`?returnTo=${encodeURIComponent(path)}`, "", origin)).toBeNull();
  });
});
