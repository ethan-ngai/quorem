/** @file editorSettings.ts @description Stores editor settings and resolves the active theme. @module editor */
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { EditorTheme } from "./PythonEditor";
import { normalizeEditorScheme } from "./editorSchemes";

export type ThemePreference = "system" | EditorTheme;

/** Reads a versioned local setting with a safe fallback. */
export function readPreference<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

/** Stores a browser-local display preference. */
export function writePreference(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences still apply for this session when browser storage is blocked or full.
  }
}

/** Returns the local storage key for a pending job. */
export function submissionStorageKey(identity: DevelopmentIdentity, workspaceId: string) {
  return `quorem.active-submission.v1:${identity}:${workspaceId}`;
}

export const editorSchemeStorageKey = "quorem.editor-scheme.v1";

/** Restores an editor scheme without accepting malformed persisted settings. */
export function readEditorScheme() {
  return normalizeEditorScheme(readPreference<unknown>(editorSchemeStorageKey, "workspace"));
}

/** @returns Validated display preferences; persisted JSON is untrusted browser data. */
export function readEditorPreferences() {
  const fontSize = readPreference<unknown>("quorem.code-font-size.v1", 15);
  const tabSize = readPreference<unknown>("quorem.tab-size.v1", 4);
  const wrap = readPreference<unknown>("quorem.wrap.v1", false);
  return {
    editorScheme: readEditorScheme(),
    fontSize:
      typeof fontSize === "number" && [12, 13, 14, 15, 16, 18, 20, 22, 24].includes(fontSize)
        ? fontSize
        : 15,
    tabSize: (tabSize === 2 ? 2 : 4) as 2 | 4,
    wrap: typeof wrap === "boolean" ? wrap : false,
  };
}
