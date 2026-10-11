/** @file PythonEditor.tsx @description Owns the stable CodeMirror document and optional intelligence extensions. @module editor */
import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  HighlightStyle,
  foldGutter,
  foldKeymap,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { Compartment, EditorState, Facet, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  rectangularSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** Theme accepted by the shared workspace token set. */
export type EditorTheme = "light" | "dark";
const emptyExtensions: Extension[] = [];

/** Public virtual URI facet used by the LSP extension factory. */
export const editorDocumentUri = Facet.define<string, string>({
  combine: (uris) => uris.at(-1) ?? "",
});

/** Imperative commands that preserve the mounted EditorView. */
export type PythonEditorHandle = {
  getSource(): string;
  focus(): void;
  applyEdit(from: number, to: number, insert: string): void;
  replaceSource(source: string): void;
};

/** Stable identity and mutable preferences for one Python document. */
type PythonEditorProps = {
  documentKey: string;
  documentUri: string;
  initialSource: string;
  theme: EditorTheme;
  fontSize: number;
  tabSize: 2 | 4;
  wrap: boolean;
  intelligenceExtensions?: Extension[];
  onSourceChange: (source: string) => void;
};

const workspaceKeymap = keymap.of([
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...searchKeymap,
  ...lintKeymap,
  indentWithTab,
]);

const baseExtensions: Extension[] = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  foldGutter(),
  bracketMatching(),
  rectangularSelection(),
  closeBrackets(),
  autocompletion(),
  python(),
  history(),
  workspaceKeymap,
  EditorView.contentAttributes.of({
    "aria-label": "Python solution editor",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
  }),
];

/** Builds only visual extensions so a theme change keeps the document intact. */
function editorTheme(theme: EditorTheme): Extension {
  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          color: "var(--color-text)",
          backgroundColor: "var(--color-field)",
          fontFamily: "var(--font-code)",
        },
        ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
        ".cm-content": { caretColor: "var(--color-primary)" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "var(--color-editor-selection) !important",
        },
        ".cm-activeLine": { backgroundColor: "var(--color-editor-active-line)" },
        ".cm-gutters": {
          color: "var(--color-text-disabled)",
          backgroundColor: "var(--color-field)",
          borderRight: "none",
        },
        ".cm-activeLineGutter": { color: "var(--color-text-secondary)" },
        ".cm-tooltip": {
          color: "var(--color-text)",
          backgroundColor: "var(--color-overlay)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
          backgroundColor: "var(--color-brand-secondary)",
          color: "var(--color-text)",
        },
        ".cm-diagnostic-error": { borderLeftColor: "var(--color-error)" },
        ".cm-diagnostic-warning": { borderLeftColor: "var(--color-warning)" },
      },
      { dark: theme === "dark" },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.keyword, color: "var(--color-editor-keyword)" },
        { tag: [tags.string, tags.special(tags.string)], color: "var(--color-editor-string)" },
        { tag: [tags.number, tags.bool, tags.null], color: "var(--color-editor-number)" },
        {
          tag: [
            tags.function(tags.variableName),
            tags.definition(tags.function(tags.variableName)),
          ],
          color: "var(--color-editor-function)",
        },
        { tag: tags.comment, color: "var(--color-editor-comment)", fontStyle: "italic" },
        {
          tag: [tags.typeName, tags.className, tags.namespace],
          color: "var(--color-editor-function)",
        },
        { tag: [tags.operator, tags.punctuation], color: "var(--color-text-secondary)" },
      ]),
    ),
  ];
}

/** Reconfigures editor display preferences without resetting history. */
function editorPreferences(fontSize: number, tabSize: 2 | 4, wrap: boolean) {
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(" ".repeat(tabSize)),
    EditorView.theme({
      "&": { fontSize: `${fontSize}px` },
      ".cm-content": { whiteSpace: wrap ? "pre-wrap" : "pre" },
      ".cm-line": { overflowWrap: wrap ? "anywhere" : "normal" },
    }),
    wrap ? EditorView.lineWrapping : [],
  ];
}

/** Mounts one CodeMirror view per document key and reconfigures optional features in place. */
export const PythonEditor = forwardRef<PythonEditorHandle, PythonEditorProps>(function PythonEditor(
  {
    documentKey,
    documentUri,
    initialSource,
    theme,
    fontSize,
    tabSize,
    wrap,
    intelligenceExtensions = emptyExtensions,
    onSourceChange,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbackRef = useRef(onSourceChange);
  const themeSlot = useRef(new Compartment());
  const preferencesSlot = useRef(new Compartment());
  const intelligenceSlot = useRef(new Compartment());

  callbackRef.current = onSourceChange;

  useImperativeHandle(
    ref,
    () => ({
      getSource: () => viewRef.current?.state.doc.toString() ?? initialSource,
      focus: () => viewRef.current?.focus(),
      applyEdit: (from, to, insert) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ changes: { from, to, insert }, userEvent: "input" });
      },
      replaceSource: (source) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: source },
          userEvent: "input",
        });
      },
    }),
    [initialSource],
  );

  useEffect(() => {
    if (!mountRef.current) return;
    const view = new EditorView({
      parent: mountRef.current,
      state: EditorState.create({
        doc: initialSource,
        extensions: [
          ...baseExtensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbackRef.current(update.state.doc.toString());
          }),
          themeSlot.current.of(editorTheme(theme)),
          preferencesSlot.current.of(editorPreferences(fontSize, tabSize, wrap)),
          intelligenceSlot.current.of(intelligenceExtensions),
          editorDocumentUri.of(documentUri),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [documentKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeSlot.current.reconfigure(editorTheme(theme)) });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: preferencesSlot.current.reconfigure(editorPreferences(fontSize, tabSize, wrap)),
    });
  }, [fontSize, tabSize, wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: intelligenceSlot.current.reconfigure(intelligenceExtensions),
    });
  }, [intelligenceExtensions]);

  return <div className="python-editor" ref={mountRef} />;
});
