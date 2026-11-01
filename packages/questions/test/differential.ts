import { expect } from "vitest";
import vectors from "../../../fixtures/migration/private/question-edge-oracle.json";
import { normalizeQuestionJson, normalizeSqlResult, validateSqlCase } from "../src/index.ts";

export function assertDifferentialVectors(): void {
  for (const vector of vectors) {
    const run = () => {
      if (vector.name === "typed")
        return normalizeQuestionJson(vector.input.type, vector.input.json);
      if (vector.name === "sqlDateCase") {
        validateSqlCase(
          {
            dialect: "postgresql",
            outputOrder: "ordered",
            tables: [{ name: "dates", columns: [{ name: "value", type: "date" }] }],
            output: [{ name: "value", type: "date" }],
          },
          vector.input.json,
        );
        return true;
      }
      return normalizeSqlResult(
        {
          dialect: "postgresql",
          outputOrder: "ordered",
          output: [{ name: "value", type: vector.input.type as "timestamp" | "timestamptz" }],
        },
        vector.input.json,
      );
    };
    const label = `${vector.name}: ${vector.input.type}: ${vector.input.json.slice(0, 80)}`;
    if ("error" in vector) expect(run, label).toThrow();
    else expect(run(), label).toBe(vector.output);
  }
}
