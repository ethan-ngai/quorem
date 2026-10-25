/** @file javaHighlighting.ts @description Java declaration and parameter context for shared syntax roles. @module editor */
import { java, javaLanguage } from "@codemirror/lang-java";
import { LanguageSupport } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import { basicCompletion, javaKeywords } from "./basicCompletion";
import type { EditorState } from "@codemirror/state";
import { signatureDocumentationTags } from "./documentationSignatures";
import { starDocumentation } from "./documentationComments";
import { parameterTag } from "./syntaxHighlighting";

/** @returns Signature tags from the upstream grammar when a compiler template is unavailable. */
function javaDocumentationTags(state: EditorState, after: number) {
  return signatureDocumentationTags(state, after, {
    declarations: [
      "ClassDeclaration",
      "InterfaceDeclaration",
      "RecordDeclaration",
      "EnumDeclaration",
      "MethodDeclaration",
      "ConstructorDeclaration",
    ],
    parameterList: "FormalParameters",
    parameterNodes: ["FormalParameter", "SpreadParameter"],
    parameterName: "Definition",
    returnTypes: [
      "PrimitiveType",
      "VoidType",
      "TypeName",
      "GenericType",
      "ArrayType",
      "AnnotatedType",
    ],
    returns: "@return",
  });
}

const language = javaLanguage.configure({
  props: [
    styleTags({
      Definition: tags.definition(tags.variableName),
      "ClassDeclaration/Definition InterfaceDeclaration/Definition EnumDeclaration/Definition RecordDeclaration/Definition":
        tags.definition(tags.className),
      "MethodDeclaration/Definition ConstructorDeclaration/Definition": tags.function(
        tags.definition(tags.variableName),
      ),
      "FormalParameter/Definition SpreadParameter/Definition CatchFormalParameter/Definition":
        parameterTag,
      Identifier: tags.variableName,
      "MethodName/Identifier": tags.function(tags.variableName),
      "FieldAccess/Identifier": tags.propertyName,
      "Annotation/Identifier MarkerAnnotation/Identifier NormalAnnotation/Identifier":
        tags.annotation,
      TypeName: tags.typeName,
      "Annotation/TypeName MarkerAnnotation/TypeName": tags.annotation,
    }),
  ],
});

export const javaExtensions = [
  language.data.of({
    documentationComments: starDocumentation.map((config) => ({
      ...config,
      tags: javaDocumentationTags,
    })),
  }),
  new LanguageSupport(language, java().support),
  basicCompletion(language, javaKeywords),
];
