import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

/** Extract reachable definitions; keep file imports aligned with the API contract. */
export function questionSchema() {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(
    new URL("../questions/question-v1.schema.json", import.meta.url),
    JSON.stringify(questionSchema(), null, 2) + "\n",
  );
}
