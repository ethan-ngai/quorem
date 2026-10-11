/** @file WorkspaceSettings.tsx @description Grouped editor, appearance, recovery, and local account controls. @module editor */
import { useEffect, useRef } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editorSettings";
import { Icon } from "./Icon";

type SettingsProps = {
  identity: DevelopmentIdentity;
  onIdentityChange: (identity: DevelopmentIdentity) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  tabSize: 2 | 4;
  onTabSizeChange: (size: 2 | 4) => void;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
  shortcuts: boolean;
  onShortcutsChange: (enabled: boolean) => void;
  onHistory: () => void;
  onClearRecovery: () => void;
};

/** @returns A compact native disclosure with accessible labeled controls. */
export function WorkspaceSettings(props: SettingsProps) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!disclosure.current?.contains(event.target as Node))
        disclosure.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && disclosure.current?.open) {
        disclosure.current.removeAttribute("open");
        disclosure.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="settings-disclosure" ref={disclosure}>
      <summary className="icon-button" aria-label="Workspace settings" title="Workspace settings">
        <Icon name="settings" />
      </summary>
      <div className="settings-popover">
        <header>
          <strong>Workspace settings</strong>
          <span>Preferences save on this device</span>
        </header>
        <fieldset>
          <legend>Appearance</legend>
          <label>
            Color theme
            <select
              aria-label="Color theme"
              value={props.theme}
              onChange={(e) => props.onThemeChange(e.target.value as ThemePreference)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Code size
            <select
              aria-label="Code font size"
              value={props.fontSize}
              onChange={(e) => props.onFontSizeChange(Number(e.target.value))}
            >
              {[12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Editor</legend>
          <label>
            Indentation
            <select
              aria-label="Indent size"
              value={props.tabSize}
              onChange={(e) => props.onTabSizeChange(Number(e.target.value) as 2 | 4)}
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </label>
          <label>
            Wrap long lines
            <input
              type="checkbox"
              checked={props.wrap}
              onChange={(e) => props.onWrapChange(e.target.checked)}
            />
          </label>
          <label>
            Keyboard shortcuts
            <input
              type="checkbox"
              checked={props.shortcuts}
              onChange={(e) => props.onShortcutsChange(e.target.checked)}
            />
          </label>
          <p className="shortcut-reference">
            <kbd>⌘ / Ctrl ↵</kbd> Run
            <br />
            <kbd>⌘ / Ctrl ⇧ ↵</kbd> Submit
            <br />
            <kbd>⌘ / Ctrl S</kbd> Save
          </p>
        </fieldset>
        <fieldset>
          <legend>Drafts</legend>
          <button className="settings-action" onClick={props.onHistory}>
            <Icon name="history" />
            Draft history
            <Icon name="arrow" />
          </button>
          <button className="settings-action" onClick={props.onClearRecovery}>
            Clear local recovery
          </button>
        </fieldset>
        <fieldset>
          <legend>Local account</legend>
          <label>
            Development identity
            <select
              aria-label="Local development identity"
              value={props.identity}
              onChange={(e) => props.onIdentityChange(e.target.value as DevelopmentIdentity)}
            >
              <option value="alice">Alice</option>
              <option value="bob">Bob</option>
            </select>
          </label>
          <p>Separate drafts and match seats for each account.</p>
        </fieldset>
      </div>
    </details>
  );
}
