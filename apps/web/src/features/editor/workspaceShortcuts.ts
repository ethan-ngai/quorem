/** Shared bindings and key tiles, displayed exactly as registered. */
export const workspaceShortcuts = {
  run: {
    binding: { key: "Enter", meta: true },
    keys: ["Meta", "Enter"],
    label: "Run",
    icon: "play",
  },
  submit: {
    binding: { key: "Enter", meta: true, shift: true },
    keys: ["Meta", "Shift", "Enter"],
    label: "Submit",
    icon: "submit",
  },
  save: { binding: { key: "S", meta: true }, keys: ["Meta", "S"], label: "Save", icon: "save" },
} as const;

export const shortcutKeySymbols: Record<string, string> = {
  Meta: "⌘",
  Shift: "⇧",
  Enter: "↵",
};

export function shortcutHint(shortcut: { label: string; keys: readonly string[] }) {
  return `${shortcut.label} (${shortcut.keys.map((key) => shortcutKeySymbols[key] ?? key).join(" ")})`;
}
