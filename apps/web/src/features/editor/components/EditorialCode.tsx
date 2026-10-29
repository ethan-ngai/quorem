/** @file EditorialCode.tsx @description Read-only editorial code with shared language highlighting. @module editor */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { editorColorTheme } from "../editorPalette";
import { loadLanguageExtensions, type EditorLanguage } from "../editorLanguages";
import type { EditorTheme } from "../PythonEditor";
import type { EditorScheme } from "../editorSchemes";

export function EditorialCode({
  source,
  language,
  theme,
  colorScheme,
}: {
  source: string;
  language: EditorLanguage;
  theme: EditorTheme;
  colorScheme: EditorScheme;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const palette = useRef(new Compartment()).current;
  const currentPalette = useRef({ theme, colorScheme });
  currentPalette.current = { theme, colorScheme };
  useEffect(() => {
    let disposed = false;
    let view: EditorView | undefined;
    setReady(false);
    void loadLanguageExtensions(language)
      .then((extensions) => {
        if (disposed || !parent.current) return;
        view = new EditorView({
          parent: parent.current,
          state: EditorState.create({
            doc: source,
            extensions: [
              extensions,
              palette.of(
                editorColorTheme(currentPalette.current.colorScheme, currentPalette.current.theme),
              ),
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorView.contentAttributes.of({ "aria-label": "Published solution" }),
            ],
          }),
        });
        viewRef.current = view;
        setReady(true);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (viewRef.current === view) viewRef.current = null;
      view?.destroy();
    };
  }, [language, source, palette]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: palette.reconfigure(editorColorTheme(colorScheme, theme)),
    });
  }, [colorScheme, theme, palette]);
  return (
    <div className="editorial-source">
      <div ref={parent} />
      {!ready && (
        <pre>
          <code>{source}</code>
        </pre>
      )}
    </div>
  );
}
