/** @file useTheme.ts @description Resolves and applies system or explicit theme choice. @module editor */
import { useEffect, useState } from "react";
import { readPreference, writePreference, type ThemePreference } from "./editorSettings";
import type { EditorTheme } from "./PythonEditor";

function resolveTheme(preference: ThemePreference): EditorTheme {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Apply before React renders route fallbacks; page hooks own subsequent changes. */
export function initializeTheme() {
  document.documentElement.dataset.theme = resolveTheme(
    readPreference<ThemePreference>("quorem.theme.v1", "system"),
  );
}

/** Keeps the app theme in sync with the user's choice and system changes. */
export function useTheme() {
  const key = "quorem.theme.v1";
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readPreference<ThemePreference>(key, "system"),
  );
  const [theme, setTheme] = useState<EditorTheme>(() => resolveTheme(preference));

  useEffect(() => {
    writePreference(key, preference);
    const applyTheme = () => {
      const next = resolveTheme(preference);
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [preference]);

  return { preference, setPreference, theme };
}
