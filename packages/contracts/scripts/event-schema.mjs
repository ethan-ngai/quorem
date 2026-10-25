/** @file event-schema.mjs @description Event envelopes reuse the canonical OpenAPI models. @module contracts */
import { readFileSync } from "node:fs";

/** @returns A standalone event schema with generated model definitions. */
export function eventSchema() {
  const template = JSON.parse(
    readFileSync(new URL("../events/envelope.template.json", import.meta.url), "utf8"),
  );
  const api = JSON.parse(readFileSync(new URL("../openapi/api.json", import.meta.url), "utf8"));
  const definitions = JSON.parse(
    JSON.stringify(api.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"),
  );
  const { $schema, $id, ...envelope } = template;
  return { $schema, $id, $defs: definitions, ...envelope };
}
