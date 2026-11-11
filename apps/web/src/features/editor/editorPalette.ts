/** @file editorPalette.ts @description Editor-scoped color schemes and visual extensions. @module editor */
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorSyntaxStyle } from "./syntaxHighlighting";

import { editorColor as color, editorColorVariable, type EditorColorRole } from "./editorColors";
import { resolveEditorPalette } from "./editorPalettes";
import type { EditorScheme } from "./editorSchemes";

const diagnosticColors = {
  error: "var(--color-error)",
  warning: `color-mix(in oklch, var(--color-warning) 70%, ${color("foreground")})`,
  info: "var(--color-info)",
  hint: color("comment"),
};

/** Builds visual extensions only; a Compartment switch retains document, cursor and undo. */
export function editorColorTheme(scheme: EditorScheme, theme: "light" | "dark"): Extension {
  const palette = resolveEditorPalette(scheme, theme);
  return [
    EditorView.theme(
      {
        "&": {
          ...Object.fromEntries(
            Object.entries(palette.colors).map(([key, value]) => [
              editorColorVariable(key as EditorColorRole),
              value,
            ]),
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
        ".cm-tooltip": {
          fontSize: "var(--text-small)",
          lineHeight: "1.5",
          maxWidth: "calc(100vw - 32px)",
        },
        ".cm-completionInfo, .cm-lsp-hover-tooltip, .cm-lsp-signature-tooltip, .cm-tooltip-lint, .cm-typescript-hover":
          {
            maxHeight: "min(260px, 40vh)",
            overflow: "auto",
          },
        ".cm-typescript-hover": { padding: "6px 8px", overflowWrap: "anywhere" },
        ".cm-typescript-hover pre": { margin: "0", whiteSpace: "pre-wrap", font: "inherit" },
        ".cm-typescript-hover-doc": { marginTop: "6px", whiteSpace: "pre-wrap" },
        ".cm-lsp-documentation pre": { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
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
        ".cm-diagnostic": {
          padding: "5px 8px",
          overflowWrap: "anywhere",
        },
        ".cm-diagnostic + .cm-diagnostic": { borderTop: `1px solid ${color("border")}` },
        ".cm-diagnosticSource": { fontSize: "0.875em", color: color("comment"), opacity: "1" },
        ".cm-lintRange": {
          paddingBottom: "0",
          textDecorationLine: "underline",
          textDecorationStyle: "wavy",
          textDecorationThickness: "1px",
          textUnderlineOffset: "2px",
          textDecorationSkipInk: "none",
        },
        ".cm-lintRange-active": { backgroundColor: color("selection") },
        ...Object.fromEntries(
          Object.entries(diagnosticColors).flatMap(([severity, tint]) => [
            [`.cm-diagnostic-${severity}`, { borderLeft: `2px solid ${tint}` }],
            [`.cm-lintRange-${severity}`, { backgroundImage: "none", textDecorationColor: tint }],
            [`.cm-lintPoint-${severity}::after`, { borderBottomColor: tint }],
          ]),
        ),
      },
      { dark: palette.dark },
    ),
    syntaxHighlighting(editorSyntaxStyle),
  ];
}
