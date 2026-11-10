import { describe, expect, it } from "vitest";
import type { PublishedQuestion } from "@quorem/contracts";
import { normalizeSqlDraft, sqlCellInputConstraint } from "./sqlDraft";

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
} as unknown as PublishedQuestion;

describe("SQL custom table drafts", () => {
  it("normalizes legacy column metadata while preserving precision, empty strings and nulls", () => {
    const setup = JSON.stringify({
      tables: [
        {
          name: "items",
          columns: problem.sql!.tables![0]!.columns,
          rows: [
            ["9223372036854775807", "12345678901234567890.1200", "", false],
            [null, null, null, null],
          ],
        },
      ],
    });
    const expected = JSON.stringify({
      columns: ["price", "id"],
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

it("guards SQL machine values without constraining text or losing bigint precision", () => {
  const integer = sqlCellInputConstraint("bigint")!;
  for (const source of ["", "-", "9223372036854775807", "-9223372036854775808"])
    expect(integer.edit(source)).toBe(true);
  for (const source of ["1.2", "abc", "9223372036854775808", "-9223372036854775809"])
    expect(integer.edit(source)).toBe(false);
  expect(integer.schema.safeParse("-").success).toBe(false);
  const number = sqlCellInputConstraint("numeric")!;
  for (const source of ["-", ".", "1e", "1e-", "1e-3", "12345678901234567890.1200"])
    expect(number.edit(source)).toBe(true);
  for (const source of ["e", "1e--2", "1.2.3", "NaN"]) expect(number.edit(source)).toBe(false);
  const date = sqlCellInputConstraint("date")!;
  expect(date.edit("2026-1")).toBe(true);
  expect(date.edit("2026-13")).toBe(false);
  expect(date.edit("2026-02-29")).toBe(false);
  expect(date.edit("2024-02-29")).toBe(true);
  expect(date.schema.safeParse("2026-11-05").success).toBe(true);
  expect(sqlCellInputConstraint("text")).toBeUndefined();
});
