import { describe, expect, it } from "vitest";
import { formatLabel } from "./formatLabel";

describe("formatLabel", () => {
  it("capitalizes words while preserving stored uppercase and mixed case", () => {
    expect(formatLabel("SQL")).toBe("SQL");
    expect(formatLabel("sql")).toBe("Sql");
    expect(formatLabel("SQL-query_processing")).toBe("SQL Query Processing");
    expect(formatLabel("iOS API")).toBe("IOS API");
    expect(formatLabel("hash-table")).toBe("Hash Table");
  });
});
