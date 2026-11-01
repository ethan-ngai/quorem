import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareSqlResult, normalizeSqlResult } from "../src/index.ts";
import type { components } from "@quorem/contracts/schema";

type SqlConfig = components["schemas"]["SqlConfig"];
const vectors = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/migration/private/go-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  name: string;
  input: { json: string; problem: { sql: SqlConfig } };
  output?: string;
  error?: string;
}[];
describe("Go SQL result vectors", () => {
  for (const v of vectors.filter((x) => x.name === "sqlNormalize" || x.name === "sqlTyped"))
    it(v.input.json, () => {
      if (v.error) expect(() => normalizeSqlResult(v.input.problem.sql, v.input.json)).toThrow();
      else expect(normalizeSqlResult(v.input.problem.sql, v.input.json)).toBe(v.output);
    });
});
it("preserves exact decimal values, duplicates, order and declared types", () => {
  const config: SqlConfig = {
    dialect: "postgresql",
    outputOrder: "unordered",
    output: [{ name: "n", type: "numeric" }],
  };
  const expected = '{"rows":[[{"$numeric":"1.00"}],[{"$numeric":"2"}],[{"$numeric":"1"}]]}';
  const actual = '{"rows":[[{"$numeric":"2.0"}],[{"$numeric":"1"}],[{"$numeric":"1"}]]}';
  expect(compareSqlResult(config, "executed", actual, expected, ["numeric"]).status).toBe(
    "accepted",
  );
  expect(compareSqlResult(config, "executed", actual, expected, ["text"]).typeMismatch).toBe(true);
  expect(
    compareSqlResult(
      config,
      "executed",
      '{"rows":[[{"$numeric":"2"}],[{"$numeric":"1"}]]}',
      expected,
      ["numeric"],
    ).status,
  ).toBe("wrong_answer");
});
it("uses timestamp microsecond ties-to-even and timezone semantics", () => {
  const config: SqlConfig = {
    dialect: "postgresql",
    outputOrder: "ordered",
    output: [
      { name: "wall", type: "timestamp" },
      { name: "instant", type: "timestamptz" },
    ],
  };
  const a = '{"rows":[["2024-01-01 12:00:00.1234565","2024-01-01T12:00:00+02:00"]]}';
  const b = '{"rows":[["2024-01-01T12:00:00.123456","2024-01-01T10:00:00Z"]]}';
  expect(normalizeSqlResult(config, a)).toBe(normalizeSqlResult(config, b));
  expect(normalizeSqlResult(config, a.replace("1234565", "1234575"))).toContain("123458");
});
