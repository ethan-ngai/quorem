/** @file PythonEditor.tsx @description Owns the stable CodeMirror document and optional intelligence extensions. @module editor */
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Facet, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
  rectangularSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { editorStateCache } from "./editorStateCache";
import { indentationGuides } from "./indentationGuides";
import { editorColorTheme } from "./editorPalette";
import type { EditorScheme } from "./editorSchemes";
import {
  pythonExtensions,
  loadLanguageExtensions,
  languageLabels,
  type EditorLanguage,
} from "./editorLanguages";

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
  language?: EditorLanguage;
  documentKey: string;
  documentUri: string;
  initialSource: string;
  theme: EditorTheme;
  colorScheme: EditorScheme;
  fontSize: number;
  tabSize: 2 | 4;
  wrap: boolean;
  readOnly?: boolean;
  intelligenceExtensions?: Extension[];
  completionEnabled?: boolean;
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
  // Keep cursor placement under editor control instead of Safari's native caret.
  drawSelection(),
  indentationGuides,
  Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  foldGutter(),
  bracketMatching(),
  rectangularSelection(),
  closeBrackets(),

  history(),
  workspaceKeymap,
];

const completionExtension = autocompletion({
  updateSyncTime: 0,
  interactionDelay: 0,
  maxRenderedOptions: 40,
  // Adjacent identical labels merge local suggestions with richer server documentation.
  compareCompletions: (a, b) => a.label.localeCompare(b.label),
});

/** Reconfigures editor display preferences without resetting history. */
function editorPreferences(fontSize: number, tabSize: 2 | 4, wrap: boolean, readOnly: boolean) {
  return [
    EditorState.tabSize.of(tabSize),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
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
    language = "python",
    documentKey,
    documentUri,
    initialSource,
    theme,
    colorScheme,
    fontSize,
    tabSize,
    wrap,
    readOnly = false,
    intelligenceExtensions = emptyExtensions,
    completionEnabled = true,
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
  const completionSlot = useRef(new Compartment());
  const languageSlot = useRef(new Compartment());

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
      state: editorStateCache.restore(documentKey, initialSource, [
        ...baseExtensions,
        completionSlot.current.of(completionEnabled ? completionExtension : []),
        languageSlot.current.of(language === "python" ? pythonExtensions : []),
        EditorView.contentAttributes.of({
          "aria-label": `${languageLabels[language]} solution editor`,
          spellcheck: "false",
          autocapitalize: "off",
          autocomplete: "off",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbackRef.current(update.state.doc.toString());
        }),
        themeSlot.current.of(editorColorTheme(colorScheme, theme)),
        preferencesSlot.current.of(editorPreferences(fontSize, tabSize, wrap, readOnly)),
        intelligenceSlot.current.of(intelligenceExtensions),
        editorDocumentUri.of(documentUri),
      ]),
    });
    viewRef.current = view;
    return () => {
      editorStateCache.save(documentKey, view.state);
      view.destroy();
      viewRef.current = null;
    };
  }, [documentKey]);

  useEffect(() => {
    const view = viewRef.current;
    let active = true;
    void loadLanguageExtensions(language)
      .then((extensions) => {
        if (active && view && viewRef.current === view)
          view.dispatch({ effects: languageSlot.current.reconfigure(extensions) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [language, documentKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeSlot.current.reconfigure(editorColorTheme(colorScheme, theme)) });
  }, [theme, colorScheme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: preferencesSlot.current.reconfigure(
        editorPreferences(fontSize, tabSize, wrap, readOnly),
      ),
    });
  }, [fontSize, tabSize, wrap, readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: completionSlot.current.reconfigure(completionEnabled ? completionExtension : []),
    });
  }, [completionEnabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: intelligenceSlot.current.reconfigure(intelligenceExtensions),
    });
  }, [intelligenceExtensions]);

  return <div className="python-editor" ref={mountRef} />;
});
