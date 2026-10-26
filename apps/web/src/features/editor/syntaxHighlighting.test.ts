/** @file syntaxHighlighting.test.ts @description Real grammar coverage and comment annotation boundaries. @module editor */
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { Tag, highlightTree, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { loadLanguageExtensions, type EditorLanguage } from "./editorLanguages";
import { editorSyntaxStyle, parameterTag } from "./syntaxHighlighting";
import { commentAnnotationDecorations } from "./commentAnnotations";

/** @returns A fully parsed state using the same language extension as the editor. */
async function parsed(language: EditorLanguage, source: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [await loadLanguageExtensions(language)],
  });
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  return state;
}

/** @returns Styles and source slices emitted by the grammar, without browser or LSP dependencies. */
function spans(state: EditorState) {
  const result: { text: string; style: string }[] = [];
  highlightTree(
    ensureSyntaxTree(state, state.doc.length, 1000)!,
    editorSyntaxStyle,
    (from, to, style) => {
      result.push({ text: state.sliceDoc(from, to), style });
    },
  );
  return result;
}

const examples: Record<Exclude<EditorLanguage, "postgresql">, string> = {
  python:
    "@cache\nclass Example:\n def solve(self, items: list[int]):\n  # TODO(owner): check FIXME and @param\n  return [x for x in items if x is not None and x >= 1]\n",
  java: "@Override class Example { public int solve(int value) { /* TODO(owner): check FIXME and @param */ return this.helper(value) + 1; } }",
  typescript:
    'export class Example { solve(value: number): boolean { /* TODO(owner): check FIXME and @param */ return value in this && /x\\d+/.test("x1"); } }',
  ocaml:
    "(* TODO(owner): check FIXME and @param *)\nlet solve value = if value > 1 then List.length [value] else 0\n",
};

describe("shared syntax roles", () => {
  it("covers every standard tag and its modifier fallbacks", () => {
    for (const [name, tag] of Object.entries(tags)) {
      if (!(tag instanceof Tag)) continue;
      expect(editorSyntaxStyle.style([tag]), name).toBeTruthy();
      expect(editorSyntaxStyle.style([tags.definition(tag)]), `definition(${name})`).toBeTruthy();
    }
    expect(editorSyntaxStyle.style([tags.operatorKeyword])).not.toBe(
      editorSyntaxStyle.style([tags.operator]),
    );
  });

  it.each(Object.keys(examples) as Exclude<EditorLanguage, "postgresql">[])(
    "styles actual %s grammar output",
    async (language) => {
      const state = await parsed(language, examples[language]);
      const missing = new Set<string>();
      highlightTree(
        ensureSyntaxTree(state, state.doc.length, 1000)!,
        {
          style: (nodeTags) => {
            if (nodeTags.length && !editorSyntaxStyle.style(nodeTags))
              missing.add(nodeTags.map(String).join(","));
            return null;
          },
        },
        () => {},
      );
      expect([...missing]).toEqual([]);
      expect(spans(state).length).toBeGreaterThan(10);
    },
  );

  it("retains TypeScript decorator, call, constructor and private method contexts", async () => {
    const result = spans(
      await parsed(
        "typescript",
        "@memo @named(1) class Example { #helper(value: number) { return fn(value) } } const obj = new Example();",
      ),
    );
    for (const [word, tag] of [
      ["memo", tags.annotation],
      ["named", tags.annotation],
      ["fn", tags.function(tags.variableName)],
      ["#helper", tags.function(tags.definition(tags.special(tags.propertyName)))],
    ] as const) {
      expect(
        result.some((span) => span.text === word && span.style === editorSyntaxStyle.style([tag])),
        word,
      ).toBe(true);
    }
    expect(
      result.some(
        (span) =>
          span.text === "Example" && span.style === editorSyntaxStyle.style([tags.className]),
      ),
    ).toBe(true);
  });

  it("recognizes Java annotations without losing method calls or class definitions", async () => {
    const result = spans(await parsed("java", examples.java));
    expect(
      result.some(
        (span) =>
          span.text === "Override" && span.style === editorSyntaxStyle.style([tags.annotation]),
      ),
    ).toBe(true);
    expect(
      result.some(
        (span) =>
          span.text === "Example" &&
          span.style === editorSyntaxStyle.style([tags.definition(tags.className)]),
      ),
    ).toBe(true);
    expect(
      result.some(
        (span) =>
          span.text === "helper" &&
          span.style === editorSyntaxStyle.style([tags.function(tags.variableName)]),
      ),
    ).toBe(true);
  });

  it("keeps Python word operators distinct from punctuation and symbolic operators", async () => {
    const state = await parsed(
      "python",
      "for x in items:\n if x is not None and x > 1 or x == 0:\n  del items[x]\n",
    );
    const result = spans(state);
    for (const word of ["in", "is", "not", "and", "or", "del"]) {
      expect(
        result.some(
          (span) =>
            span.text === word && span.style === editorSyntaxStyle.style([tags.operatorKeyword]),
        ),
        word,
      ).toBe(true);
    }
    expect(
      result.some(
        (span) =>
          span.text === ">" && span.style === editorSyntaxStyle.style([tags.compareOperator]),
      ),
    ).toBe(true);
  });

  it.each(["java", "typescript"] as const)(
    "recognizes %s method declarations and parameters",
    async (language) => {
      const result = spans(await parsed(language, examples[language]));
      expect(
        result.some(
          (span) =>
            (span.text === "solve" &&
              span.style ===
                editorSyntaxStyle.style([tags.function(tags.definition(tags.variableName))])) ||
            (span.text === "solve" &&
              span.style ===
                editorSyntaxStyle.style([tags.function(tags.definition(tags.propertyName))])),
        ),
      ).toBe(true);
      expect(
        result.some(
          (span) => span.text === "value" && span.style === editorSyntaxStyle.style([parameterTag]),
        ),
      ).toBe(true);
    },
  );
});

/** @returns Annotation text and class for a parsed document or viewport slice. */
function markers(state: EditorState, from = 0, to = state.doc.length) {
  const found: { text: string; class: string }[] = [];
  commentAnnotationDecorations(state, [{ from, to }]).between(from, to, (start, end, value) => {
    if (value.spec.class !== "cm-doc-comment")
      found.push({ text: state.sliceDoc(start, end), class: value.spec.class });
  });
  return found;
}

describe("comment annotations", () => {
  it.each(Object.keys(examples) as Exclude<EditorLanguage, "postgresql">[])(
    "colors task text through the end of %s comments",
    async (language) => {
      expect(markers(await parsed(language, examples[language]))).toEqual([
        { text: "TODO(owner): check ", class: "cm-comment-task" },
        { text: "FIXME and @param", class: "cm-comment-fixme" },
      ]);
    },
  );

  it.each([
    ["python", 'TODO = "FIXME @param"\n# NOTTODO TODO_ITEM person@example.org\n'],
    [
      "java",
      'class TODO { String text = "FIXME @param"; } // NOTTODO TODO_ITEM person@example.org\n',
    ],
    ["typescript", "const TODO = `FIXME @param`; // NOTTODO TODO_ITEM person@example.org\n"],
    ["ocaml", 'let todo = "FIXME @param" (* NOTTODO TODO_ITEM person@example.org *)\n'],
  ] as const)("ignores marker-looking strings and identifiers in %s", async (language, source) => {
    expect(markers(await parsed(language, source))).toEqual([]);
  });

  it("updates annotations after comment delimiters change", async () => {
    const initial = await parsed("python", '# TODO\ntext = "FIXME"\n');
    expect(markers(initial)).toHaveLength(1);
    const next = initial.update({ changes: { from: 0, to: 2, insert: "" } }).state;
    ensureSyntaxTree(next, next.doc.length, 1000);
    expect(markers(next)).toEqual([]);
  });

  it("restricts marks to the visible portion of multiline comments", async () => {
    const source = "/* TODO\n FIXME\n NOTE */";
    const state = await parsed("typescript", source);
    expect(markers(state, source.indexOf("FIXME"), source.indexOf("NOTE"))).toEqual([
      { text: "FIXME", class: "cm-comment-fixme" },
    ]);
  });

  it("recognizes markers in nested OCaml comments", async () => {
    expect(
      markers(await parsed("ocaml", "(* TODO (* FIXME *) NOTE *)")).map((mark) => mark.text),
    ).toEqual(["TODO (* ", "FIXME *) ", "NOTE"]);
  });
});

describe("task text continuation", () => {
  it.each([
    ["python", "# TODO: first\n#   continued text\n# ordinary comment\nvalue = 1\n"],
    ["java", "// TODO: first\n//   continued text\n// ordinary comment\nclass C {}\n"],
    [
      "typescript",
      "/* TODO: first\n *   continued text\n * ordinary comment\n */\nconst value = 1;\n",
    ],
    ["ocaml", "(* TODO: first\n   continued text\nordinary comment\n*)\nlet value = 1\n"],
  ] as const)("colors only the associated %s task text", async (language, source) => {
    const state = await parsed(language, source);
    const result = markers(state);
    expect(result.map((mark) => mark.text)).toEqual(["TODO: first", "continued text"]);
    const continuation = source.indexOf("continued text");
    expect(markers(state, continuation, continuation + "continued text".length)).toEqual([
      { text: "continued text", class: "cm-comment-task" },
    ]);
  });

  it.each([
    ["python", "# @param items description"],
    ["java", "/** @param items description */"],
    ["typescript", "/** @returns description */"],
    ["ocaml", "(* @param items description *)"],
  ] as const)("keeps %s documentation tags separate from task text", async (language, source) => {
    const result = markers(await parsed(language, source));
    expect(result).toHaveLength(1);
    expect(result[0].class).toBe("cm-comment-doc-tag");
    expect(result[0].text).toMatch(/^@(param|returns)$/);
  });

  it("does not carry task color into a separate block comment", async () => {
    const state = await parsed("typescript", "/* TODO: first */\n/*   ordinary comment */");
    expect(markers(state).map((mark) => mark.text)).toEqual(["TODO: first"]);
  });
});

it.each([
  ["java", "/** A description.\n * @param value input\n */\nclass Example {}"],
  [
    "typescript",
    "/** A description.\n * @param value input\n */\nfunction solve(value: number) {}",
  ],
  ["ocaml", "(** A description.\n    @param value input\n*)\nlet solve value = value"],
] as const)(
  "colors the entire %s documentation comment independently of its tags",
  async (language, source) => {
    const state = await parsed(language, source);
    const decorations = commentAnnotationDecorations(state, [{ from: 0, to: source.length }]);
    const docText: string[] = [];
    decorations.between(0, state.doc.length, (from, to, value) => {
      if (value.spec.class === "cm-doc-comment") docText.push(state.sliceDoc(from, to));
    });
    expect(docText.join("")).toContain("A description.");
    expect(docText.join("")).toContain("@param value input");
    expect(docText.join("")).not.toContain("class Example");
    expect(markers(state).some((marker) => marker.class === "cm-comment-doc-tag")).toBe(true);
  },
);
