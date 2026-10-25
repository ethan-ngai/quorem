/** @file generate.mjs @description Generate API types with a valid recursive wire alias. @module contracts */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
import ts from "typescript";
import { questionSchema } from "./question-schema.mjs";
import { eventSchema } from "./event-schema.mjs";

/** @returns Generated declarations derived entirely from the OpenAPI schema. */
export async function generateContracts() {
  const schema = JSON.parse(readFileSync(new URL("../openapi/api.json", import.meta.url), "utf8"));
  let wireAlias;
  const ast = await openapiTS(schema, {
    postTransform(type, { path }) {
      if (path !== "#/components/schemas/WireValue" || !ts.isUnionTypeNode(type)) return;
      // Recursive indexed-access properties become TS2502; a named alias supports recursion.
      const transformed = ts.transform(type, [
        (context) => {
          const visit = (node) => {
            if (
              ts.isIndexedAccessTypeNode(node) &&
              ts.isLiteralTypeNode(node.indexType) &&
              ts.isStringLiteral(node.indexType.literal) &&
              node.indexType.literal.text === "WireValue"
            ) {
              return ts.factory.createTypeReferenceNode("WireValue");
            }
            return ts.visitEachChild(node, visit, context);
          };
          return (node) => ts.visitNode(node, visit);
        },
      ]);
      wireAlias = ts.factory.createTypeAliasDeclaration(
        [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        "WireValue",
        undefined,
        transformed.transformed[0],
      );
      transformed.dispose();
      return ts.factory.createTypeReferenceNode("WireValue");
    },
  });
  if (!wireAlias) throw new Error("WireValue schema must generate a recursive union");
  return COMMENT_HEADER + astToString([wireAlias, ...ast]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(new URL("../src/generated.ts", import.meta.url), await generateContracts());
  writeFileSync(
    new URL("../events/envelope.schema.json", import.meta.url),
    JSON.stringify(eventSchema(), null, 2) + "\n",
  );
  writeFileSync(
    new URL("../questions/question-v1.schema.json", import.meta.url),
    JSON.stringify(questionSchema(), null, 2) + "\n",
  );
}
