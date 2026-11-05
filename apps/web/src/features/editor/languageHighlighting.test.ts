/** @file languageHighlighting.test.ts @description Cross-language type, declaration and literal regression matrix. @module editor */
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree, tags, type Tag } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { loadLanguageExtensions, type EditorLanguage } from "./editorLanguages";
import { editorSyntaxStyle, parameterTag } from "./syntaxHighlighting";
import { highlightedPython, pythonTypeIdentifier } from "./pythonHighlighting";

async function styles(language: EditorLanguage, source: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [await loadLanguageExtensions(language)],
  });
  const tree = ensureSyntaxTree(state, source.length, 1000)!;
  expect(tree).not.toBeNull();
  const spans: { from: number; to: number; style: string }[] = [];
  highlightTree(tree, editorSyntaxStyle, (from, to, style) => spans.push({ from, to, style }));
  return (text: string, tag: Tag) => {
    const from = source.indexOf(text);
    expect(from, text).toBeGreaterThanOrEqual(0);
    expect(
      spans.some(
        (span) =>
          span.from <= from &&
          span.to >= from + text.length &&
          span.style === editorSyntaxStyle.style([tag]),
      ),
      text,
    ).toBe(true);
  };
}

it("colors Java records, sealed types, annotation declarations, generics and varargs", async () => {
  const check = await styles(
    "java",
    "@interface Meta { String value(); }\nsealed interface Node permits Leaf {}\nrecord Leaf<T>(T item) implements Node { Leaf {} void run(String... args) {} }",
  );
  for (const [text, tag] of [
    ["Meta", tags.definition(tags.className)],
    ["value", tags.function(tags.definition(tags.variableName))],
    ["sealed", tags.modifier],
    ["permits", tags.definitionKeyword],
    ["record", tags.definitionKeyword],
    ["T", tags.definition(tags.className)],
    ["item", parameterTag],
    ["args", parameterTag],
  ] as const)
    check(text, tag);
});

it("colors Java inferred lambda parameters", async () => {
  const check = await styles(
    "java",
    "record Leaf(int value) { Leaf {} void run() { var fn = (left, right) -> left; } }",
  );
  check("left", parameterTag);
  check("right", parameterTag);
});

it("colors TypeScript type signatures and namespaces before the compiler is ready", async () => {
  const check = await styles(
    "typescript",
    "namespace Space { interface Box<T> { map(value: T): T; } type Alias = Box<number>; const fn = (item: Alias) => item; }",
  );
  for (const [text, tag] of [
    ["Space", tags.namespace],
    ["Box", tags.definition(tags.typeName)],
    ["T", tags.definition(tags.typeName)],
    ["map", tags.function(tags.definition(tags.propertyName))],
    ["value", parameterTag],
    ["item", parameterTag],
    ["Alias", tags.definition(tags.typeName)],
  ] as const)
    check(text, tag);
});

it("colors OCaml modules, constructors, variants, labels, type variables and characters", async () => {
  const check = await styles(
    "ocaml",
    "let f ~label (x : 'a option) = match x with Some value -> Array.length [| 'x'; '\\n' |] | None -> `Empty\nlet text = \"Some Array 'x'\"\n(* Some Array *)",
  );
  for (const [text, tag] of [
    ["~label", tags.labelName],
    ["'a", tags.typeName],
    ["Some", tags.className],
    ["Array", tags.className],
    ["None", tags.className],
    ["`Empty", tags.atom],
    ["'x'", tags.character],
    ["'\\n'", tags.character],
    ["\"Some Array 'x'\"", tags.string],
    ["(* Some Array *)", tags.comment],
  ] as const)
    check(text, tag);
});

it("uses PostgreSQL grammar for quoted identifiers, dollar strings, casts and nested comments", async () => {
  const check = await styles(
    "postgresql",
    'SELECT "User", $$TreeNode$$, $tag$Optional$tag$, true, 42::integer /* outer /* inner */ end */ FROM users',
  );
  for (const [text, tag] of [
    ["SELECT", tags.keyword],
    ['"User"', tags.name],
    ["$$TreeNode$$", tags.string],
    ["$tag$Optional$tag$", tags.string],
    ["true", tags.bool],
    ["42", tags.number],
    ["integer", tags.typeName],
    ["/* outer /* inner */ end */", tags.comment],
  ] as const)
    check(text, tag);
});

describe("Python annotation contexts", () => {
  it.each([
    [
      "def solve(root: Optional[TreeNode]) -> list[int]: pass",
      ["Optional", "TreeNode", "list", "int"],
    ],
    ["root: pkg.Tree | None = None", ["pkg", "Tree"]],
    [
      "callback: Callable[[TreeNode, int], Optional[TreeNode]]",
      ["Callable", "TreeNode", "int", "Optional", "TreeNode"],
    ],
    [
      "root: Annotated[Optional[TreeNode], marker(TreeNode)]",
      ["Annotated", "Optional", "TreeNode"],
    ],
    ["root: Literal[Color.RED]", ["Literal"]],
    ["root: 'TreeNode'", []],
    ["type Forest[T] = dict[str, list[T]]", ["Forest", "T", "dict", "str", "list", "T"]],
    [
      "from typing import Optional\nfrom quorem_types import TreeNode\nTreeNode = 1\nroot = TreeNode",
      [],
    ],
  ])("recognizes type identifiers in %s", (source, expected) => {
    const found: string[] = [];
    highlightedPython.parser.parse(source).iterate({
      enter(node) {
        if (pythonTypeIdentifier(node.node, (from, to) => source.slice(from, to)))
          found.push(source.slice(node.from, node.to));
      },
    });
    expect(found).toEqual(expected);
  });
});
