/** @file typeScriptHover.ts @description Renders compiler quick info with the editor's syntax palette. @module editor */
import { highlightingFor } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { EditorView, TooltipView } from "@codemirror/view";
import { parameterTag } from "./syntaxHighlighting";

type DisplayPart = { kind: string; text: string };
type QuickInfo = {
  displayParts?: readonly DisplayPart[];
  documentation?: readonly DisplayPart[];
};

const displayTags = new Map([
  ["aliasName", tags.typeName],
  ["className", tags.className],
  ["enumName", tags.typeName],
  ["enumMemberName", tags.constant(tags.name)],
  ["fieldName", tags.propertyName],
  ["functionName", tags.function(tags.variableName)],
  ["interfaceName", tags.typeName],
  ["keyword", tags.keyword],
  ["methodName", tags.function(tags.propertyName)],
  ["moduleName", tags.namespace],
  ["numericLiteral", tags.number],
  ["operator", tags.operator],
  ["parameterName", parameterTag],
  ["propertyName", tags.propertyName],
  ["punctuation", tags.punctuation],
  ["regularExpressionLiteral", tags.regexp],
  ["stringLiteral", tags.string],
  ["typeParameterName", tags.typeName],
]);

/** Render semantic display parts because quick-info signatures are not standalone programs. */
export function renderTypeScriptHover(
  { quickInfo }: { quickInfo: QuickInfo | undefined },
  view: EditorView,
): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-typescript-hover";
  const signature = dom.appendChild(document.createElement("pre"));
  for (const part of quickInfo?.displayParts ?? []) {
    const tag = displayTags.get(part.kind);
    const style = tag && highlightingFor(view.state, [tag]);
    if (style) {
      const span = signature.appendChild(document.createElement("span"));
      span.className = style;
      span.textContent = part.text;
    } else {
      signature.append(part.text);
    }
  }
  const documentation = quickInfo?.documentation?.map((part) => part.text).join("");
  if (documentation) {
    const details = dom.appendChild(document.createElement("div"));
    details.className = "cm-typescript-hover-doc";
    details.textContent = documentation;
  }
  return { dom };
}
