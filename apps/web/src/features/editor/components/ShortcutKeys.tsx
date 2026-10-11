import { shortcutKeySymbols } from "../workspaceShortcuts";

export function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="shortcut-keys">
      {keys.map((key) => (
        <kbd key={key} aria-label={key}>
          {shortcutKeySymbols[key] ?? key}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutHint({
  shortcut,
}: {
  shortcut: { label: string; keys: readonly string[] };
}) {
  return (
    <span className="shortcut-hint">
      {shortcut.label}
      <ShortcutKeys keys={shortcut.keys} />
    </span>
  );
}
