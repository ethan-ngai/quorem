/** @file question-schema.mjs @description Derive question schemas and standalone validators. @module contracts */
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

/** @returns The reachable OpenAPI definitions for full question content. */
function questionSchema() {
  const api = JSON.parse(readFileSync(new URL("../openapi/api.json", import.meta.url), "utf8"));
  const definitions = {};
  function collect(name) {
    if (name in definitions) return;
    const definition = api.components.schemas[name];
    definitions[name] = JSON.parse(
      JSON.stringify(definition).replaceAll("#/components/schemas/", "#/$defs/"),
    );
    for (const match of JSON.stringify(definition).matchAll(
      /#\/components\/schemas\/([A-Za-z0-9_]+)/g,
    ))
      collect(match[1]);
  }
  collect("QuestionContent");
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Quorem question v1",
    $ref: "#/$defs/QuestionContent",
    $defs: definitions,
  };
}
/**
 * @param {object} problem Full authored problem schema.
 * @returns {object} Problem shape accepted from a file.
 */
export function questionImportProblem(problem) {
  return {
    ...problem,
    required: problem.required.filter((field) => field !== "id" && field !== "limits"),
    properties: {
      ...problem.properties,
      id: {
        ...problem.properties.id,
        description: "Optional legacy metadata. Publication assigns its own ID.",
      },
      slug: {
        ...problem.properties.slug,
        // Match the authored budget and the namespace used by private publications.
        pattern: "^(?=(?:private-[0-9a-f]{16}-)?[a-z0-9-]{1,80}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
      },
      leetcodeId: { type: ["integer", "null"], minimum: 1, maximum: 2147483647 },
      limits: {
        ...problem.properties.limits,
        description: "Omit to use the default execution limits.",
      },
    },
  };
}

/** @returns File shape with defaults and server-assigned identity omitted. */
export function questionImportSchema() {
  const schema = questionSchema();
  schema.$defs.AuthoredQuestionProblem = questionImportProblem(
    schema.$defs.AuthoredQuestionProblem,
  );
  return schema;
}

/** Generate a CSP-safe standalone validator from the canonical question schema. */
export function questionValidator(draft = false) {
  const schema = questionSchema();
  if (draft) {
    const relax = (value) => {
      if (Array.isArray(value)) {
        value.forEach(relax);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const key of [
        "required",
        "enum",
        "const",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "uniqueItems",
        "not",
      ])
        delete value[key];
      if (value.oneOf) {
        value.anyOf = value.oneOf;
        delete value.oneOf;
      }
      Object.values(value).forEach(relax);
    };
    relax(schema);
    schema.$defs.WireValue = {};
    const constraintProperties = {};
    const collect = (value) => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (!value || typeof value !== "object") return;
      if (value.properties)
        for (const [key, property] of Object.entries(value.properties))
          constraintProperties[key] ??= property;
      Object.values(value).forEach(collect);
    };
    collect(schema.$defs.Constraint);
    schema.$defs.Constraint = {
      anyOf: [
        { type: "string" },
        { type: "object", properties: constraintProperties, additionalProperties: false },
      ],
    };
  }
  return standaloneValidator(schema);
}

/** @returns The CSP-safe validator for the file shape. */
export function questionImportValidator() {
  return standaloneValidator(questionImportSchema());
}

/**
 * @param {object} schema Question shape to compile.
 * @returns {string} Generated validator source.
 */
function standaloneValidator(schema) {
  const ajv = new Ajv2020({ strict: true, code: { source: true, esm: true } });
  const code = standaloneCode(ajv, ajv.compile(schema));
  const required = 'require("ajv/dist/runtime/ucs2length").default';
  const usesLength = code.includes(required);
  const transformed = code.replaceAll(required, "ucs2length");
  if (transformed.includes("require(")) throw new Error("Unexpected Ajv standalone require");
  return (
    "/* oxlint-disable */\n" +
    (usesLength ? "const ucs2length = (value) => Array.from(value).length;\n" : "") +
    transformed +
    "\n"
  );
}
