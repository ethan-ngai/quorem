import { useState } from "react";
import {
  writePreference,
  readEditorPreferences,
  editorSchemeStorageKey,
} from "../editor/editorSettings";
import type { EditorScheme } from "../editor/editorSchemes";

/** Shared display preferences for workspaces and settings on every route. */
export function useLocalEditorPreferences() {
  const [initial] = useState(readEditorPreferences);
  const [editorScheme, scheme] = useState(initial.editorScheme);
  const [fontSize, font] = useState(initial.fontSize);
  const [tabSize, tab] = useState(initial.tabSize);
  const [wrap, wrapping] = useState(initial.wrap);
  return {
    editorScheme,
    onEditorSchemeChange: (value: EditorScheme) => {
      writePreference(editorSchemeStorageKey, value);
      scheme(value);
    },
    fontSize,
    onFontSizeChange: (value: number) => {
      writePreference("quorem.code-font-size.v1", value);
      font(value);
    },
    tabSize,
    onTabSizeChange: (value: 2 | 4) => {
      writePreference("quorem.tab-size.v1", value);
      tab(value);
    },
    wrap,
    onWrapChange: (value: boolean) => {
      writePreference("quorem.wrap.v1", value);
      wrapping(value);
    },
  };
}
