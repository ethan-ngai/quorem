/** Editor scheme identifiers shared with browser-local preferences. */
export const editorSchemes = [
  { id: "workspace", label: "Workspace" },
  { id: "jetbrains-light", label: "JetBrains Light" },
  { id: "darcula", label: "Darcula" },
  { id: "one-dark", label: "One Dark" },
] as const;
export type EditorScheme = (typeof editorSchemes)[number]["id"];

/** Rejects stale or invalid persisted scheme identifiers. */
export function normalizeEditorScheme(value: unknown): EditorScheme {
  return editorSchemes.find((scheme) => scheme.id === value)?.id ?? "workspace";
}
