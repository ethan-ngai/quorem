/** @file editorPalette.ts @description Editor-scoped color schemes and visual extensions. @module editor */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { parameterTag } from "./pythonHighlighting";

export const editorSchemes = [
  { id: "workspace", label: "Workspace" },
  { id: "jetbrains-light", label: "JetBrains Light" },
  { id: "darcula", label: "Darcula" },
  { id: "one-dark", label: "One Dark" },
] as const;
export type EditorScheme = (typeof editorSchemes)[number]["id"];

type Palette = {
  dark: boolean;
  colors: Record<
    | "background"
    | "foreground"
    | "gutter"
    | "gutterText"
    | "activeLine"
    | "selection"
    | "cursor"
    | "tooltip"
    | "border"
    | "keyword"
    | "string"
    | "number"
    | "function"
    | "class"
    | "builtin"
    | "parameter"
    | "operator"
    | "decorator"
    | "comment"
    | "self",
    string
  >;
};

const palettes: Record<Exclude<EditorScheme, "workspace">, Palette> = {
  "jetbrains-light": {
    dark: false,
    colors: {
      background: "#ffffff",
      foreground: "#242424",
      gutter: "#ffffff",
      gutterText: "#666666",
      activeLine: "#fffae3",
      selection: "#d4e2ff",
      cursor: "#242424",
      tooltip: "#f7f7f7",
      border: "#d0d0d0",
      keyword: "#000080",
      string: "#067d17",
      number: "#0000ff",
      function: "#7a5600",
      class: "#7a5600",
      builtin: "#660e7a",
      parameter: "#705b33",
      operator: "#454545",
      decorator: "#707000",
      comment: "#666666",
      self: "#94558d",
    },
  },
  darcula: {
    dark: true,
    colors: {
      background: "#2b2b2b",
      foreground: "#a9b7c6",
      gutter: "#2b2b2b",
      gutterText: "#9d9d9d",
      activeLine: "#323232",
      selection: "#214283",
      cursor: "#a9b7c6",
      tooltip: "#313335",
      border: "#515151",
      keyword: "#e09049",
      string: "#a3be8c",
      number: "#82aad0",
      function: "#ffc66d",
      class: "#a9b7c6",
      builtin: "#a3a3d4",
      parameter: "#d7b88b",
      operator: "#a9b7c6",
      decorator: "#bbb529",
      comment: "#9d9d9d",
      self: "#e09049",
    },
  },
  "one-dark": {
    dark: true,
    colors: {
      background: "#282c34",
      foreground: "#abb2bf",
      gutter: "#282c34",
      gutterText: "#929cad",
      activeLine: "#2c313a",
      selection: "#3e4451",
      cursor: "#528bff",
      tooltip: "#353a42",
      border: "#4b5263",
      keyword: "#c982dd",
      string: "#98c379",
      number: "#d19a66",
      function: "#61afef",
      class: "#e5c07b",
      builtin: "#56b6c2",
      parameter: "#d19a66",
      operator: "#56b6c2",
      decorator: "#e5c07b",
      comment: "#929cad",
      self: "#e9848b",
    },
  },
};

/** Rejects stale or invalid persisted scheme identifiers. */
export function normalizeEditorScheme(value: unknown): EditorScheme {
  return editorSchemes.find((scheme) => scheme.id === value)?.id ?? "workspace";
}

/** Resolves scheme mode independently of the surrounding app theme. */
export function resolveEditorPalette(scheme: EditorScheme, theme: "light" | "dark"): Palette {
  if (scheme !== "workspace") return palettes[scheme];
  const dark = theme === "dark";
  return {
    dark,
    colors: {
      background: "var(--color-field)",
      foreground: "var(--color-text)",
      gutter: "var(--color-field)",
      gutterText: "var(--color-text-disabled)",
      activeLine: "var(--color-editor-active-line)",
      selection: "var(--color-editor-selection)",
      cursor: "var(--color-primary)",
      tooltip: "var(--color-overlay)",
      border: "var(--color-border)",
      keyword: "var(--color-editor-keyword)",
      string: "var(--color-editor-string)",
      number: "var(--color-editor-number)",
      function: "var(--color-editor-function)",
      class: dark ? "#e5c07b" : "#876b13",
      builtin: dark ? "#c792ea" : "#7c3f8c",
      parameter: dark ? "#d7b88b" : "#815c23",
      operator: "var(--color-text-secondary)",
      decorator: dark ? "#c792ea" : "#7c3f8c",
      comment: "var(--color-editor-comment)",
      self: "var(--color-editor-keyword)",
    },
  };
}

/** Returns a CSS variable scoped to the mounted editor. */
function color(name: keyof Palette["colors"]) {
  return `var(--editor-${name})`;
}
const literalOperators = [tags.operator, tags.operatorKeyword];

/** Palette variables share parser rules across schemes without regenerating style classes. */
export const pythonSyntaxStyle = HighlightStyle.define([
  { tag: tags.keyword, color: color("keyword") },
  { tag: [tags.string, tags.special(tags.string), tags.escape], color: color("string") },
  { tag: [tags.number, tags.bool, tags.null], color: color("number") },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.function(tags.variableName)),
    ],
    color: color("function"),
  },
  {
    tag: [tags.typeName, tags.className, tags.definition(tags.className)],
    color: color("class"),
    fontWeight: "600",
  },
  { tag: parameterTag, color: color("parameter") },
  { tag: tags.comment, color: color("comment"), fontStyle: "italic" },
  { tag: literalOperators, color: color("operator") },
  { tag: tags.punctuation, color: color("foreground") },
  { tag: [tags.meta, tags.annotation], color: color("decorator") },
]);

/** Builds visual extensions only; a Compartment switch retains document, cursor and undo. */
export function editorColorTheme(scheme: EditorScheme, theme: "light" | "dark"): Extension {
  const palette = resolveEditorPalette(scheme, theme);
  return [
    EditorView.theme(
      {
        "&": {
          ...Object.fromEntries(
            Object.entries(palette.colors).map(([key, value]) => [`--editor-${key}`, value]),
          ),
          height: "100%",
          color: color("foreground"),
          backgroundColor: color("background"),
          colorScheme: palette.dark ? "dark" : "light",
          fontFamily: "var(--font-code)",
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "inherit",
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        },
        ".cm-content": {
          caretColor: color("cursor"),
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: color("cursor") },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
          backgroundColor: `${color("selection")} !important`,
        },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: color("activeLine") },
        ".cm-gutters": {
          color: color("gutterText"),
          backgroundColor: color("gutter"),
          borderRight: "none",
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        },
        ".cm-activeLineGutter": { color: color("foreground") },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "calc(3ch + 8px)",
          padding: "0 8px 0 0",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        },
        ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", textAlign: "center" },
        ".cm-foldGutter span": {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "14px",
          height: "14px",
          padding: "0",
          verticalAlign: "middle",
          fontSize: "0",
          opacity: "0.65",
        },
        ".cm-foldGutter span::after": {
          content: '""',
          width: "5px",
          height: "5px",
          borderRight: "1px solid currentColor",
          borderBottom: "1px solid currentColor",
          transform: "translateY(-1px) rotate(45deg)",
        },
        '.cm-foldGutter span[title="Unfold line"]::after': {
          transform: "translateX(-1px) rotate(-45deg)",
        },
        ".cm-foldGutter span:hover": { opacity: "1" },
        ".cm-matchingBracket, .cm-selectionMatch": { backgroundColor: color("selection") },
        ".cm-nonmatchingBracket": { textDecoration: "underline wavy var(--color-error)" },
        ".cm-searchMatch": {
          backgroundColor: color("selection"),
          outline: `1px solid ${color("border")}`,
        },
        ".cm-searchMatch-selected": { outline: `1px solid ${color("cursor")}` },
        ".cm-panels, .cm-tooltip": {
          color: color("foreground"),
          backgroundColor: color("tooltip"),
          border: `1px solid ${color("border")}`,
          borderRadius: "var(--radius-md)",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
          backgroundColor: color("selection"),
          color: color("foreground"),
        },
        ".cm-tooltip-arrow:after": {
          borderTopColor: color("tooltip"),
          borderBottomColor: color("tooltip"),
        },
        ".cm-foldPlaceholder": {
          color: color("comment"),
          backgroundColor: color("activeLine"),
          borderColor: color("border"),
        },
        ".cm-python-builtin, .cm-python-builtin span": { color: color("builtin") },
        ".cm-python-self, .cm-python-self span": { color: color("self") },
        ".cm-diagnostic-error": { borderLeftColor: "var(--color-error)" },
        ".cm-diagnostic-warning": { borderLeftColor: "var(--color-warning)" },
      },
      { dark: palette.dark },
    ),
    syntaxHighlighting(pythonSyntaxStyle),
  ];
}
