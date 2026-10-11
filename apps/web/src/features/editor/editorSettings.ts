/** @file editorSettings.ts @description Stores editor settings and resolves the active theme. @module editor */
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { EditorTheme } from "./PythonEditor";
import { normalizeEditorScheme } from "./editorPalette";

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
  localStorage.setItem(key, JSON.stringify(value));
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
