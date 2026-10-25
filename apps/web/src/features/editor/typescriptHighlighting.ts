/** @file typescriptHighlighting.ts @description TypeScript parameter and method context for shared syntax roles. @module editor */
import { javascript, typescriptLanguage } from "@codemirror/lang-javascript";
import { LanguageSupport } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import type { EditorState } from "@codemirror/state";
import { signatureDocumentationTags } from "./documentationSignatures";
import { starDocumentation } from "./documentationComments";
import { parameterTag } from "./syntaxHighlighting";

/** @returns Signature tags from the upstream grammar when a compiler template is unavailable. */
function typescriptDocumentationTags(state: EditorState, after: number) {
  return signatureDocumentationTags(state, after, {
    declarations: [
      "ClassDeclaration",
      "FunctionDeclaration",
      "MethodDeclaration",
      "FunctionExpression",
      "ArrowFunction",
    ],
    parameterList: "ParamList",
    parameterNodes: ["VariableDefinition"],
    returnTypes: ["TypeAnnotation"],
    returns: "@returns",
  });
}

const language = typescriptLanguage.configure({
  props: [
    styleTags({
      VariableName: tags.variableName,
      "CallExpression/VariableName TaggedTemplateExpression/VariableName": tags.function(
        tags.variableName,
      ),
      "NewExpression/VariableName": tags.className,
      "Decorator/VariableName Decorator/CallExpression/VariableName": tags.annotation,
      VariableDefinition: tags.definition(tags.variableName),
      "FunctionDeclaration/VariableDefinition FunctionExpression/VariableDefinition": tags.function(
        tags.definition(tags.variableName),
      ),
      "ClassDeclaration/VariableDefinition ClassExpression/VariableDefinition": tags.definition(
        tags.className,
      ),
      "ParamList/VariableDefinition ArrowFunction/VariableDefinition": parameterTag,
      PrivatePropertyDefinition: tags.definition(tags.special(tags.propertyName)),
      "MethodDeclaration/PrivatePropertyDefinition": tags.function(
        tags.definition(tags.special(tags.propertyName)),
      ),
      PropertyDefinition: tags.definition(tags.propertyName),
      "MethodDeclaration/PropertyDefinition": tags.function(tags.definition(tags.propertyName)),
    }),
  ],
});

export const typescriptExtensions = [
  language.data.of({
    documentationComments: starDocumentation.map((config) => ({
      ...config,
      tags: typescriptDocumentationTags,
    })),
  }),
  new LanguageSupport(language, javascript({ typescript: true }).support),
];
