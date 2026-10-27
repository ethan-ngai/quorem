import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SqlTables } from "./SqlTables";
import { CaseOutput } from "./CaseOutput";

describe("SQL table presentation", () => {
  it("renders named input tables, types, nulls and empty rows", () => {
    const html = renderToStaticMarkup(
      <SqlTables
        input
        label="Input"
        value={{
          tables: [
            {
              name: "items",
              columns: [
                { name: "id", type: "integer" },
                { name: "note", type: "text" },
              ],
              rows: [
                [1, null],
                [2, ""],
              ],
            },
            { name: "orders", columns: [{ name: "amount", type: "numeric" }], rows: [] },
          ],
        }}
      />,
    );
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain('aria-label="items table"');
    expect(html).toContain("integer");
    expect(html).toContain("NULL");
    expect(html).toContain("No rows");
  });
  it("renders run output and expected results without losing numeric precision", () => {
    const html = renderToStaticMarkup(
      <CaseOutput
        sql={{ dialect: "postgresql", outputOrder: "unordered" }}
        result={{
          index: 0,
          status: "wrong_answer",
          actual: { columns: ["amount"], rows: [[{ $numeric: "12345678901234567890.1200" }]] },
          expected: { columns: ["amount"], rows: [[{ $bigint: "9223372036854775807" }]] },
        }}
      />,
    );
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain("12345678901234567890.1200");
    expect(html).toContain("9223372036854775807");
    expect(html).not.toContain("$numeric");
  });
  it("falls back safely for malformed values", () => {
    const html = renderToStaticMarkup(<SqlTables label="Output" value={{ unexpected: true }} />);
    expect(html).toContain("unexpected");
    expect(html).not.toContain("<table");
  });
});

it("uses the shared schema for row-only input and expected output", () => {
  const schema = {
    dialect: "postgresql" as const,
    outputOrder: "unordered" as const,
    tables: [{ name: "items", columns: [{ name: "id", type: "integer" as const }] }],
    output: [{ name: "total", type: "bigint" as const }],
  };
  const input = renderToStaticMarkup(
    <SqlTables
      input
      label="Input"
      schema={schema}
      value={{ tables: [{ name: "items", rows: [[3]] }] }}
    />,
  );
  const output = renderToStaticMarkup(
    <SqlTables
      label="Output"
      schema={schema}
      value={{ rows: [[{ $bigint: "9223372036854775807" }]] }}
    />,
  );
  expect(input).toContain("<table");
  expect(input).toContain("integer");
  expect(output).toContain("total");
  expect(output).toContain("9223372036854775807");
});

it("shows declared and actual output types without conflating them", () => {
  const schema = {
    dialect: "postgresql" as const,
    outputOrder: "unordered" as const,
    output: [{ name: "total", type: "bigint" as const }],
  };
  const html = renderToStaticMarkup(
    <CaseOutput
      sql={schema}
      result={{
        index: 0,
        status: "wrong_answer",
        sqlTypes: ["text"],
        actual: { columns: ["total"], rows: [["1"]] },
        expected: { columns: ["total"], rows: [[1]] },
      }}
    />,
  );
  expect(html).toContain("<small>text</small>");
  expect(html).toContain("<small>bigint</small>");
  const unknown = renderToStaticMarkup(
    <CaseOutput
      sql={schema}
      result={{ index: 0, status: "wrong_answer", actual: { columns: ["total"], rows: [] } }}
    />,
  );
  expect(unknown).not.toContain("<small>bigint</small>");
});
