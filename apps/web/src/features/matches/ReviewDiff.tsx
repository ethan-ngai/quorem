/** @file ReviewDiff.tsx @description Read-only CodeMirror comparison for matching languages. @module matches */
import { unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { loadLanguageExtensions, type EditorLanguage } from "../editor/editorLanguages";
import { editorColorTheme } from "../editor/editorPalette";
import type { EditorScheme } from "../editor/editorSchemes";
import type { EditorTheme } from "../editor/PythonEditor";

export function ReviewDiff({
  original,
  source,
  language,
  theme,
  colorScheme,
}: {
  original: string;
  source: string;
  language: EditorLanguage;
  theme: EditorTheme;
  colorScheme: EditorScheme;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const palette = useRef(new Compartment()).current;
  const currentPalette = useRef({ theme, colorScheme });
  currentPalette.current = { theme, colorScheme };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setFailed(false);
    void loadLanguageExtensions(language)
      .then((syntax) => {
        if (disposed || !parent.current) return;
        view.current = new EditorView({
          parent: parent.current,
          state: EditorState.create({
            doc: source,
            extensions: [
              syntax,
              lineNumbers(),
              palette.of(
                editorColorTheme(currentPalette.current.colorScheme, currentPalette.current.theme),
              ),
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorView.contentAttributes.of({ "aria-label": "Code differences" }),
              unifiedMergeView({ original, mergeControls: false }),
            ],
          }),
        });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      view.current?.destroy();
      view.current = null;
    };
  }, [original, source, language, palette]);
  useEffect(() => {
    view.current?.dispatch({ effects: palette.reconfigure(editorColorTheme(colorScheme, theme)) });
  }, [colorScheme, theme, palette]);
  return (
    <>
      <div ref={parent} />
      {failed && (
        <div role="alert">
          <p>Diff unavailable. Sources shown below.</p>
          <h3>Your code</h3>
          <pre>{original}</pre>
          <h3>Opponent code</h3>
          <pre>{source}</pre>
        </div>
      )}
    </>
  );
}
