/** @file EditorialCode.tsx @description Read-only editorial code with shared language highlighting. @module editor */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { editorColorTheme } from "../editorPalette";
import { loadLanguageExtensions, type EditorLanguage } from "../editorLanguages";
import { useTheme } from "../useTheme";

export function EditorialCode({ source, language }: { source: string; language: EditorLanguage }) {
  const parent = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();
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
              editorColorTheme("workspace", theme),
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorView.contentAttributes.of({ "aria-label": "Published solution" }),
            ],
          }),
        });
        setReady(true);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      view?.destroy();
    };
  }, [language, source, theme]);
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
