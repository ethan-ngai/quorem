/** @file ProblemStatement.test.tsx @description Public inputs retain their declared argument names. @module editor */
import type { ProblemVersion } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import { exampleInput } from "./ProblemStatement";

describe("named public example inputs", () => {
  it("pairs multiple arguments with declared parameter names in order", () => {
    const problem = {
      signature: { parameters: [{ name: "nums" }, { name: "target" }] },
    } as ProblemVersion;
    expect(exampleInput(problem, [[2, 7, 11, 15], 9])).toBe("nums = [2,7,11,15], target = 9");
  });
});
