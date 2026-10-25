/** @file documentationSignatures.ts @description Documentation tags derived from upstream syntax trees. @module editor */
import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Grammar node names supplied by a language adapter, not a second source-code parser. */
export type DocumentationSignature = {
  declarations: readonly string[];
  parameterList: string;
  parameterNodes: readonly string[];
  parameterName?: string;
  returnTypes: readonly string[];
  returns: "@return" | "@returns";
};

/** @returns Parameter/return/throws tags for the following declaration using its existing grammar tree. */
export function signatureDocumentationTags(
  state: EditorState,
  after: number,
  config: DocumentationSignature,
): string[] {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, after + 10000), 50);
  if (!tree) return [];
  let declaration: ReturnType<typeof tree.resolve> | undefined;
  tree.iterate({
    from: after,
    enter(node) {
      if (declaration) return false;
      if (node.from >= after && config.declarations.includes(node.name)) {
        declaration = node.node;
        return false;
      }
    },
  });
  if (!declaration) return [];
  const result: string[] = [];
  const parameters = declaration.getChild(config.parameterList);
  for (let node = parameters?.firstChild; node; node = node.nextSibling) {
    if (!config.parameterNodes.includes(node.name)) continue;
    const name = config.parameterName ? node.getChild(config.parameterName) : node;
    if (name) result.push(`@param ${state.sliceDoc(name.from, name.to)}`);
  }
  for (let node = declaration.firstChild; node; node = node.nextSibling) {
    if (config.returnTypes.includes(node.name)) {
      const type = state.sliceDoc(node.from, node.to).replace(/^:\s*/, "").trim();
      if (type !== "void" && type !== "never") result.push(config.returns);
      break;
    }
  }
  const throws = declaration.getChild("Throws");
  if (throws)
    for (let node = throws.firstChild; node; node = node.nextSibling) {
      if (/Type$|TypeName$/.test(node.name))
        result.push(`@throws ${state.sliceDoc(node.from, node.to)}`);
    }
  return result;
}
