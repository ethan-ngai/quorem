/** @file editorColors.ts @description Scheme color contract shared by palettes and highlighting. @module editor */
export type EditorPalette = {
  dark: boolean;
  colors: Record<
    | "background"
    | "foreground"
    | "gutter"
    | "gutterText"
    | "activeLine"
    | "selection"
    | "cursor"
    | "tooltip"
    | "border"
    | "keyword"
    | "string"
    | "number"
    | "function"
    | "class"
    | "builtin"
    | "parameter"
    | "operator"
    | "decorator"
    | "docComment"
    | "docTag"
    | "todo"
    | "comment"
    | "self",
    string
  >;
};

export type EditorColorRole = keyof EditorPalette["colors"];

/** @returns A CSS variable name stable across CodeMirror's camel-case property normalization. */
export function editorColorVariable(role: EditorColorRole) {
  return `--editor-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** @returns A scheme color inherited from the mounted editor. */
export function editorColor(role: EditorColorRole) {
  return `var(${editorColorVariable(role)})`;
}
