/** @file syntaxHighlighting.ts @description Language-neutral syntax roles and scheme-scoped styles. @module editor */
import { HighlightStyle } from "@codemirror/language";
import { editorColor as syntaxColor } from "./editorColors";
import { Tag, tags } from "@lezer/highlight";

export const parameterTag = Tag.define("parameter", tags.variableName);

/** Parent tags cover grammar-specific subtypes without per-language theme copies. */
export const editorSyntaxStyle = HighlightStyle.define([
  { tag: [tags.name, tags.content, tags.monospace], color: syntaxColor("foreground") },
  { tag: tags.literal, color: syntaxColor("number") },
  { tag: tags.keyword, color: syntaxColor("keyword") },
  { tag: [tags.bool, tags.null, tags.atom], color: syntaxColor("keyword") },
  { tag: tags.self, color: syntaxColor("self") },
  { tag: [tags.string, tags.docString], color: syntaxColor("string") },
  { tag: tags.regexp, color: syntaxColor("string") },
  { tag: [tags.escape, tags.character], color: syntaxColor("builtin") },
  { tag: tags.number, color: syntaxColor("number") },
  { tag: tags.operator, color: syntaxColor("operator") },
  { tag: tags.operatorKeyword, color: syntaxColor("keyword") },
  { tag: tags.punctuation, color: syntaxColor("foreground") },
  { tag: [tags.typeName, tags.className], color: syntaxColor("class") },
  { tag: tags.definition(tags.className), color: syntaxColor("class"), fontWeight: "600" },
  { tag: tags.namespace, color: syntaxColor("class") },
  { tag: tags.labelName, color: syntaxColor("decorator") },
  { tag: tags.propertyName, color: syntaxColor("parameter") },
  { tag: tags.function(tags.variableName), color: syntaxColor("function") },
  { tag: tags.function(tags.propertyName), color: syntaxColor("function") },
  { tag: tags.function(tags.punctuation), color: syntaxColor("function") },
  { tag: tags.constant(tags.name), color: syntaxColor("number") },
  { tag: tags.standard(tags.name), color: syntaxColor("builtin") },
  { tag: [tags.meta, tags.annotation, tags.macroName], color: syntaxColor("decorator") },
  { tag: parameterTag, color: syntaxColor("parameter") },
  { tag: tags.docComment, color: syntaxColor("docComment"), fontStyle: "italic" },
  { tag: tags.comment, color: syntaxColor("comment"), fontStyle: "italic" },
  { tag: [tags.url, tags.link], color: syntaxColor("function"), textDecoration: "underline" },
  { tag: tags.heading, color: syntaxColor("class"), fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.inserted, color: "var(--color-success)" },
  { tag: tags.deleted, color: "var(--color-error)" },
  { tag: tags.changed, color: "var(--color-warning)" },
  { tag: tags.invalid, textDecoration: "underline wavy var(--color-error)" },
]);
