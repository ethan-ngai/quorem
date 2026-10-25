/** @file useLocalEditorPreferences.ts @description Shared browser-local editor preferences. @module settings */
import { useEffect, useState } from "react";
import {
  writePreference,
  readEditorPreferences,
  editorSchemeStorageKey,
  readEditorSchemes,
} from "../editor/editorSettings";
import type { EditorScheme, EditorMode } from "../editor/editorSchemes";

/** Shared display preferences for workspaces and settings on every route. */
export function useLocalEditorPreferences() {
  const [initial] = useState(readEditorPreferences);
  const [editorSchemes, scheme] = useState(initial.editorSchemes);
  useEffect(() => {
    const sync = (event: Event) => {
      if (
        event instanceof StorageEvent &&
        event.key !== null &&
        event.key !== editorSchemeStorageKey
      )
        return;
      scheme(event instanceof CustomEvent ? event.detail : readEditorSchemes());
    };
    window.addEventListener("quorem:editor-schemes", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("quorem:editor-schemes", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const [fontSize, font] = useState(initial.fontSize);
  const [tabSize, tab] = useState(initial.tabSize);
  const [wrap, wrapping] = useState(initial.wrap);
  return {
    editorSchemes,
    onEditorSchemeChange: (mode: EditorMode, value: EditorScheme) => {
      const next = { ...editorSchemes, [mode]: value };
      writePreference(editorSchemeStorageKey, next);
      scheme(next);
      window.dispatchEvent(new CustomEvent("quorem:editor-schemes", { detail: next }));
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
