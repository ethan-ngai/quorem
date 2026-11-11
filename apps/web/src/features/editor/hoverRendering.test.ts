// @vitest-environment happy-dom
/** @file hoverRendering.test.ts @description Covers language-service hover markup and syntax roles. @module editor */
import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorView } from "@codemirror/view";
import DOMPurify from "dompurify";
import { expect, it } from "vitest";
import { editorColorTheme } from "./editorPalette";
import { PythonLanguageClient } from "./pythonLanguageClient";
import { renderTypeScriptHover } from "./typeScriptHover";

it("highlights Python hover fences using the editor scheme", () => {
  const client = new PythonLanguageClient({ sanitizeHTML: (html) => DOMPurify.sanitize(html) });
  const view = new EditorView({
    extensions: [
      editorColorTheme("jetbrains-light", "light"),
      client.plugin("file:///main.py", "python"),
    ],
  });
  try {
    const html = LSPPlugin.get(view)!.docToHTML(
      '```py\ndef append(value: str = "<pear>"): ...\n```',
      "markdown",
    );
    const rendered = document.createElement("div");
    rendered.innerHTML = html;
    expect([...rendered.querySelectorAll("code span")].map((span) => span.textContent)).toEqual(
      expect.arrayContaining(["def", "append", "value", '"<pear>"']),
    );
  } finally {
    view.destroy();
  }
});

it("highlights TypeScript quick info and renders documentation as text", () => {
  const view = new EditorView({ extensions: editorColorTheme("jetbrains-dark", "dark") });
  try {
    const { dom } = renderTypeScriptHover(
      {
        quickInfo: {
          displayParts: [
            { kind: "methodName", text: "push" },
            { kind: "punctuation", text: "(" },
            { kind: "parameterName", text: "item" },
            { kind: "text", text: ": " },
            { kind: "keyword", text: "string" },
            { kind: "punctuation", text: ")" },
          ],
          documentation: [{ kind: "text", text: "Accepts <items>." }],
        },
      },
      view,
    );
    expect(dom.querySelector("pre")?.textContent).toBe("push(item: string)");
    expect([...dom.querySelectorAll("pre span")].map((span) => span.textContent)).toEqual(
      expect.arrayContaining(["push", "item", "string"]),
    );
    expect(dom.querySelector(".cm-typescript-hover-doc")?.textContent).toBe("Accepts <items>.");
  } finally {
    view.destroy();
  }
});
