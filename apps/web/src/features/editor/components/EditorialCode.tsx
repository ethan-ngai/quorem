/** @file EditorialCode.tsx @description Read-only editorial code with shared language highlighting. @module editor */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { editorColorTheme } from "../editorPalette";
import { loadLanguageExtensions, type EditorLanguage } from "../editorLanguages";
import type { EditorTheme } from "../PythonEditor";
import type { EditorScheme } from "../editorSchemes";
import { contentChangeMotion } from "../../../ui/contentChangeMotion";

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
  const syntax = useRef(new Compartment()).current;
  const stopMotion = useRef<() => void>(undefined);
  const currentPalette = useRef({ theme, colorScheme });
  currentPalette.current = { theme, colorScheme };
  useEffect(
    () => () => {
      stopMotion.current?.();
      viewRef.current?.destroy();
      viewRef.current = null;
    },
    [],
  );
  useEffect(() => {
    let disposed = false;
    void loadLanguageExtensions(language)
      .then((extensions) => {
        if (disposed || !parent.current) return;
        const previous = viewRef.current;
        if (previous) {
          stopMotion.current?.();
          stopMotion.current = contentChangeMotion(parent.current, () => {
            previous.dispatch({
              changes: { from: 0, to: previous.state.doc.length, insert: source },
              selection: { anchor: 0 },
              effects: syntax.reconfigure(extensions),
            });
            previous.scrollDOM.scrollTop = 0;
            previous.scrollDOM.scrollLeft = 0;
          });
          return;
        }
        const view = new EditorView({
          parent: parent.current,
          state: EditorState.create({
            doc: source,
            extensions: [
              syntax.of(extensions),
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
    };
  }, [language, source, palette, syntax]);
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
