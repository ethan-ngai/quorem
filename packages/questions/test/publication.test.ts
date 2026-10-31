import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import {
  validateQuestionDefinition,
  validateQuestionPublication,
  validateSqlCase,
} from "../src/index.ts";
import type { components } from "@quorem/contracts/schema";

const require = createRequire(new URL("../../contracts/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats").default;
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
const schema = JSON.parse(
  readFileSync(
    new URL("../../contracts/questions/question-v1.schema.json", import.meta.url),
    "utf8",
  ),
);
const validate = ajv.compile(schema);
const checkSchema = (raw: string) => {
  if (!validate(JSON.parse(raw))) throw new Error(JSON.stringify(validate.errors));
};
const example = JSON.parse(
  readFileSync(new URL("../../contracts/questions/example-v1.json", import.meta.url), "utf8"),
);
const runtime = (language: string) =>
  language === "python" ? { revision: "python-3.12-v1", harness: "quorem-harness-v2" } : undefined;

it("validates existing schema and authored definition before publication", () => {
  const content = structuredClone(example);
  content.implementations = [
    {
      language: "python",
      runtimeRevision: "python-3.12-v1",
      harnessRevision: "quorem-harness-v2",
      starterSource: "pass",
      referenceSource: "pass",
    },
  ];
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
  const raw = readFileSync(
    new URL("../../../fixtures/odyssey/balance-ledger.json", import.meta.url),
    "utf8",
  );
  const fixture = JSON.parse(raw);
  const resolve = (language: string) => {
    const impl = fixture.implementations.find((x: { language: string }) => x.language === language);
    return impl && { revision: impl.runtimeRevision, harness: impl.harnessRevision };
  };
  expect(() => validateQuestionPublication(raw, checkSchema, resolve)).not.toThrow();
  fixture.odysseyHiddenCases[0].push(fixture.odysseyHiddenCases[1][0]);
  expect(() =>
    validateQuestionPublication(JSON.stringify(fixture), checkSchema, resolve),
  ).toThrow();
});
it("validates SQL publication and rejects invalid fixture types", () => {
  const content = structuredClone(example);
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
  content.implementations = [
    {
      language: "postgresql",
      runtimeRevision: "postgresql-17.6-v1",
      harnessRevision: "quorem-postgresql-v2",
      starterSource: "select 1",
      referenceSource: "select 1",
    },
  ];
  content.solutions = [];
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
    const data = JSON.parse(raw);
    const resolve = (language: string) => {
      const impl = data.implementations.find((x: { language: string }) => x.language === language);
      return impl && { revision: impl.runtimeRevision, harness: impl.harnessRevision };
    };
    expect(() => validateQuestionPublication(raw, checkSchema, resolve), name).not.toThrow();
  }
});
it("accepts eight valid Odyssey levels with twenty hidden cases each", () => {
  const raw = readFileSync(
    new URL("../../../fixtures/odyssey/balance-ledger.json", import.meta.url),
    "utf8",
  );
  const fixture = JSON.parse(raw);
  const level = fixture.problem.odyssey.levels[0];
  const hidden = fixture.odysseyHiddenCases[0][0];
  fixture.problem.odyssey.levels = Array.from({ length: 8 }, (_, i) => ({
    ...structuredClone(level),
    methods:
      i === 0
        ? structuredClone(level.methods)
        : [{ ...structuredClone(level.methods[0]), methodName: `extra${i}` }],
  }));
  fixture.odysseyHiddenCases = Array.from({ length: 8 }, () =>
    Array.from({ length: 20 }, () => structuredClone(hidden)),
  );
  const resolve = (language: string) => {
    const impl = fixture.implementations.find((x: { language: string }) => x.language === language);
    return impl && { revision: impl.runtimeRevision, harness: impl.harnessRevision };
  };
  expect(() =>
    validateQuestionPublication(JSON.stringify(fixture), checkSchema, resolve),
  ).not.toThrow();
});
