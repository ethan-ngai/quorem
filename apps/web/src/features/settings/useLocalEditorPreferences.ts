import { useState } from "react";
import {
  readPreference,
  writePreference,
  readEditorScheme,
  editorSchemeStorageKey,
} from "../editor/editorSettings";
import type { EditorScheme } from "../editor/editorSchemes";

/** Outside a workspace, editor preferences still save only to this browser. */
export function useLocalEditorPreferences() {
  const [editorScheme, scheme] = useState(readEditorScheme);
  const [fontSize, font] = useState(() => readPreference("quorem.code-font-size.v1", 15));
  const [tabSize, tab] = useState<2 | 4>(() => readPreference("quorem.tab-size.v1", 4));
  const [wrap, wrapping] = useState(() => readPreference("quorem.wrap.v1", false));
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
