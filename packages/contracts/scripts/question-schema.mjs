import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(
    new URL("../questions/question-v1.schema.json", import.meta.url),
    JSON.stringify(questionSchema(), null, 2) + "\n",
  );
}
