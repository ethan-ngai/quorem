import { describe, expect, it } from "vitest";
import type { ProblemVersion } from "@quorem/contracts";
import { normalizeSqlDraft } from "./sqlDraft";

const problem = {
  sql: {
    dialect: "postgresql",
    outputOrder: "unordered",
    tables: [
      {
        name: "items",
        columns: [
          { name: "id", type: "bigint" },
          { name: "price", type: "numeric" },
          { name: "name", type: "text" },
          { name: "active", type: "boolean" },
        ],
      },
    ],
    output: [
      { name: "price", type: "numeric" },
      { name: "id", type: "bigint" },
    ],
  },
} as unknown as ProblemVersion;

describe("SQL custom table drafts", () => {
  it("preserves large integers, decimals, empty strings and nulls", () => {
    const setup = JSON.stringify({
      tables: [
        {
          name: "items",
          rows: [
            ["9223372036854775807", "12345678901234567890.1200", "", false],
            [null, null, null, null],
          ],
        },
      ],
    });
    const expected = JSON.stringify({
      rows: [["12345678901234567890.1200", "9223372036854775807"]],
    });
    expect(normalizeSqlDraft(problem, setup, expected)).toEqual({
      args: [
        {
          tables: [
            {
              name: "items",
              rows: [
                ["9223372036854775807", "12345678901234567890.1200", "", false],
                [null, null, null, null],
              ],
            },
          ],
        },
      ],
      expected: {
        rows: [[{ $numeric: "12345678901234567890.1200" }, { $bigint: "9223372036854775807" }]],
      },
    });
  });
  it("identifies invalid cells and rejects wrong row widths", () => {
    expect(() =>
      normalizeSqlDraft(
        problem,
        JSON.stringify({
          tables: [{ name: "items", rows: [["99999999999999999999", "1", "x", true]] }],
        }),
      ),
    ).toThrow("items, row 1, id");
    expect(() =>
      normalizeSqlDraft(problem, JSON.stringify({ tables: [{ name: "items", rows: [["1"]] }] })),
    ).toThrow("wrong number of cells");
  });
});

it("rejects real output beyond PostgreSQL's float32 range", () => {
  const realProblem = {
    ...problem,
    sql: { ...problem.sql!, output: [{ name: "value", type: "real" as const }] },
  };
  const setup = JSON.stringify({ tables: [{ name: "items", rows: [] }] });
  expect(() => normalizeSqlDraft(realProblem, setup, JSON.stringify({ rows: [[3.5e38]] }))).toThrow(
    "in range",
  );
  expect(() =>
    normalizeSqlDraft(realProblem, setup, JSON.stringify({ rows: [[3.4e38]] })),
  ).not.toThrow();
});

it("rejects NUL in SQL input and expected text", () => {
  const textProblem = {
    ...problem,
    sql: { ...problem.sql!, output: [{ name: "name", type: "text" as const }] },
  };
  const setup = (name: string) =>
    JSON.stringify({ tables: [{ name: "items", rows: [["1", "2", name, true]] }] });
  expect(() => normalizeSqlDraft(textProblem, setup("a\0b"))).toThrow("NUL");
  expect(() =>
    normalizeSqlDraft(textProblem, setup("valid"), JSON.stringify({ rows: [["a\0b"]] })),
  ).toThrow("NUL");
  expect(() => normalizeSqlDraft(textProblem, setup("\\0"))).not.toThrow();
});
