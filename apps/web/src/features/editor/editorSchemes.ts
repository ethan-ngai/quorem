/** @file editorSchemes.ts @description Scheme catalog and mode-specific validation. @module editor */
export const editorSchemes = [
  { id: "workspace", label: "Workspace", mode: "system" },
  { id: "jetbrains-light", label: "JetBrains Light", mode: "light" },
  { id: "jetbrains-dark", label: "JetBrains Dark", mode: "dark" },
  { id: "darcula", label: "Darcula", mode: "dark" },
  { id: "one-dark", label: "One Dark", mode: "dark" },
  { id: "github-light", label: "GitHub Light", mode: "light" },
  { id: "github-dark", label: "GitHub Dark", mode: "dark" },
  { id: "solarized-light", label: "Solarized Light", mode: "light" },
  { id: "solarized-dark", label: "Solarized Dark", mode: "dark" },
] as const;
export type EditorScheme = (typeof editorSchemes)[number]["id"];
export type EditorMode = "light" | "dark";
export type EditorSchemePreferences = Record<EditorMode, EditorScheme>;

export const defaultEditorSchemes: EditorSchemePreferences = {
  light: "jetbrains-light",
  dark: "jetbrains-dark",
};

/** @returns Choices compatible with the global appearance mode. */
export function editorSchemesForMode(mode: EditorMode) {
  return editorSchemes.filter((scheme) => scheme.mode === mode || scheme.mode === "system");
}

/** @returns Valid choice for this mode, falling back to its JetBrains default. */
export function normalizeEditorSchemeForMode(value: unknown, mode: EditorMode): EditorScheme {
  return (
    editorSchemesForMode(mode).find((scheme) => scheme.id === value)?.id ??
    defaultEditorSchemes[mode]
  );
}
