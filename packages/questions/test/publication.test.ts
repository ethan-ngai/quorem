import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import {
  validateQuestionDefinition,
  validateQuestionPublication,
  validateSqlCase,
  normalizeQuestionDraft,
  validateQuestionSchema as checkSchema,
} from "../src/index.ts";
import type { components } from "@quorem/contracts/schema";

const example = JSON.parse(
  normalizeQuestionDraft(
    readFileSync(new URL("../../contracts/questions/example-v1.json", import.meta.url), "utf8"),
  ),
);
const runtime = () => ({ revision: "runtime", harness: "harness" });

it("validates existing schema and authored definition before publication", () => {
  const content = structuredClone(example);
  const raw = JSON.stringify(content);
  expect(() => validateQuestionPublication(raw, checkSchema, runtime)).not.toThrow();
  content.hiddenCases = [];
  expect(() =>
    validateQuestionDefinition(JSON.stringify(content), checkSchema, false),
  ).not.toThrow();
  expect(() => validateQuestionPublication(JSON.stringify(content), checkSchema, runtime)).toThrow(
    "hidden",
  );
  content.hiddenCases = [{ args: [[1.5]], expected: [1] }];
  expect(() =>
    validateQuestionPublication(JSON.stringify(content), checkSchema, runtime),
  ).toThrow();
});
it("validates SQL schema-bound fixtures without numeric precision loss", () => {
  const config: components["schemas"]["SqlConfig"] = {
    dialect: "postgresql",
    outputOrder: "ordered",
    tables: [{ name: "users", columns: [{ name: "id", type: "bigint" }] }],
    output: [{ name: "id", type: "bigint" }],
  };
  const good =
    '{"args":[{"tables":[{"name":"users","rows":[["9223372036854775807"]]}]}],"expected":{"rows":[[{"$bigint":"9223372036854775807"}]]}}';
  expect(() => validateSqlCase(config, good)).not.toThrow();
  expect(() =>
    validateSqlCase(config, good.replace("9223372036854775807", "9223372036854775808")),
  ).toThrow();
  expect(() => validateSqlCase(config, good.replace('"users"', '"wrong"'))).toThrow();
});
it("validates the existing staged fixture and rejects calls to future methods", () => {
  const raw = normalizeQuestionDraft(
    readFileSync(new URL("../../../fixtures/odyssey/balance-ledger.json", import.meta.url), "utf8"),
  );
  const fixture = JSON.parse(raw);
  const resolve = runtime;
  expect(() => validateQuestionPublication(raw, checkSchema, resolve)).not.toThrow();
  fixture.problem.odyssey.levels[0].hiddenCases.push(
    fixture.problem.odyssey.levels[1].hiddenCases[0],
  );
  expect(() =>
    validateQuestionPublication(JSON.stringify(fixture), checkSchema, resolve),
  ).toThrow();
});
it("validates SQL publication and rejects invalid fixture types", () => {
  const content = structuredClone(example);
  delete content.problem.signature;
  content.problem.sql = {
    dialect: "postgresql",
    outputOrder: "ordered",
    tables: [{ name: "items", columns: [{ name: "id", type: "integer" }] }],
    output: [{ name: "id", type: "integer" }],
  };
  content.problem.constraints = [];
  content.problem.examples = [
    { args: [{ tables: [{ name: "items", rows: [[1]] }] }], expected: { rows: [[1]] } },
  ];
  content.hiddenCases = structuredClone(content.problem.examples);
  content.approaches = [
    {
      ...content.approaches[0],
      implementations: [{ language: "postgresql", source: "select 1" }],
    },
  ];
  const resolve = () => ({ revision: "postgresql-17.6-v1", harness: "quorem-postgresql-v2" });
  expect(() =>
    validateQuestionPublication(JSON.stringify(content), checkSchema, resolve),
  ).not.toThrow();
  content.hiddenCases[0].args[0].tables[0].rows = [["wrong"]];
  expect(() => validateQuestionPublication(JSON.stringify(content), checkSchema, resolve)).toThrow(
    "invalid SQL table value",
  );
});

it("accepts published coding fixture corpus", () => {
  const dir = new URL("../../../fixtures/problems/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const raw = readFileSync(new URL(name, dir), "utf8");
    const resolve = runtime;
    expect(() => validateQuestionPublication(raw, checkSchema, resolve), name).not.toThrow();
  }
});
it("accepts eight valid Odyssey levels with twenty hidden cases each", () => {
  const raw = normalizeQuestionDraft(
    readFileSync(new URL("../../../fixtures/odyssey/balance-ledger.json", import.meta.url), "utf8"),
  );
  const fixture = JSON.parse(raw);
  const level = fixture.problem.odyssey.levels[0];
  const hidden = level.hiddenCases[0];
  fixture.problem.odyssey.levels = Array.from({ length: 8 }, (_, i) => ({
    ...structuredClone(level),
    hiddenCases: Array.from({ length: 20 }, () => structuredClone(hidden)),
    methods:
      i === 0
        ? structuredClone(level.methods)
        : [{ ...structuredClone(level.methods[0]), methodName: `extra${i}` }],
  }));
  const resolve = runtime;
  expect(() =>
    validateQuestionPublication(JSON.stringify(fixture), checkSchema, resolve),
  ).not.toThrow();
});

it("rejects documentation that would generate an unrunnable starter", () => {
  const content = structuredClone(example);
  content.problem.signature.description = "x".repeat(65536);
  expect(() => validateQuestionPublication(JSON.stringify(content), checkSchema, runtime)).toThrow(
    "Generated starter exceeds execution source bounds",
  );
});
