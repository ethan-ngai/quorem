import { describe, expect, it } from "vitest";
import { inputConstraints, isAllowedInput, validateInput, withMaxBytes } from "./input-constraints";

describe("input constraints", () => {
  it("allows partial numbers but rejects impossible characters and upper bounds", () => {
    const integer = inputConstraints.integer({ min: 1, max: 100 });
    expect(["", "0", "1", "100"].every((v) => isAllowedInput(v, integer))).toBe(true);
    expect(["-", "101", "1e2", "1.5"].every((v) => !isAllowedInput(v, integer))).toBe(true);
    expect(validateInput("0", integer).success).toBe(false);
    expect(validateInput("100", integer).success).toBe(true);
    const decimal = inputConstraints.decimal({ min: -2, max: 5 });
    expect(["-", ".", "-.", "1."].every((v) => isAllowedInput(v, decimal))).toBe(true);
    expect(validateInput("-.", decimal).success).toBe(false);
    expect(validateInput("-2.5", decimal).success).toBe(false);
  });
  it("accepts scientific drafts but validates complete finite numbers", () => {
    const constraint = inputConstraints.scientific;
    expect(["-", ".", "1e", "1e-"].every((value) => isAllowedInput(value, constraint))).toBe(true);
    expect(validateInput("1e-", constraint).success).toBe(false);
    expect(validateInput("-1.5e+3", constraint).success).toBe(true);
    expect(validateInput("1e999", constraint).success).toBe(false);
  });
  it("enforces UTF-8 byte limits for editing and validation", () => {
    const constraint = withMaxBytes(inputConstraints.name, 4);
    expect(isAllowedInput("éé", constraint)).toBe(true);
    expect(isAllowedInput("ééa", constraint)).toBe(false);
    expect(validateInput("ééa", constraint).success).toBe(false);
  });
  it("keeps ordinary names editable and rejects controls and repeated spaces", () => {
    expect(isAllowedInput("Ada Lovelace ", inputConstraints.name)).toBe(true);
    expect(isAllowedInput("Ada  Lovelace", inputConstraints.name)).toBe(false);
    expect(isAllowedInput("Ada\nLovelace", inputConstraints.name)).toBe(false);
    expect(isAllowedInput("Ada\u200bLovelace", inputConstraints.name)).toBe(false);
    expect(validateInput("Ada ", inputConstraints.name).data).toBe("Ada");
    expect(validateInput(" ", inputConstraints.name).success).toBe(false);
  });
  it("distinguishes partial identifiers and email from complete values", () => {
    expect(isAllowedInput("123", inputConstraints.identifier)).toBe(false);
    expect(validateInput("123", inputConstraints.identifier).success).toBe(false);
    expect(isAllowedInput("hello@", inputConstraints.email)).toBe(true);
    expect(validateInput("hello@", inputConstraints.email).success).toBe(false);
    expect(validateInput("hello@example.com", inputConstraints.email).success).toBe(true);
  });
});
