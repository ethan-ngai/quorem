/** @file WorkspaceSettings.tsx @description Shared local preference sections and accessible controls. @module editor */
import * as Switch from "@radix-ui/react-switch";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { SelectField } from "../../../ui/SelectField";
import type { ThemePreference } from "../editorSettings";
import { editorSchemes, type EditorScheme } from "../editorSchemes";
import { workspaceShortcuts } from "../workspaceShortcuts";
import { ShortcutKeys } from "./ShortcutKeys";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

export type SettingsProps = {
  onOpenChange?: (open: boolean) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  editorScheme: EditorScheme;
  onEditorSchemeChange: (scheme: EditorScheme) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  tabSize: 2 | 4;
  onTabSizeChange: (size: 2 | 4) => void;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
  onHistory?: () => void;
  onClearRecovery?: () => void;
  onImportDrafts?: (file: File) => Promise<void>;
};

export const workspaceSections = [
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "editor", label: "Editor", icon: "code" },
  { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
  { id: "drafts", label: "Drafts", icon: "history" },
] as const;

const themes = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

function Setting({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <span>{label}</span>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch.Root
      className="settings-switch"
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
    >
      <Switch.Thumb className="settings-switch-thumb" />
    </Switch.Root>
  );
}

export type WorkspaceSection = (typeof workspaceSections)[number]["id"];

export function WorkspaceSettingsContent({
  section,
  ...props
}: SettingsProps & { section: WorkspaceSection; onClose?: () => void }) {
  return (
    <>
      {section === "appearance" && (
        <>
          <Setting label="Color theme">
            <div className="theme-segments" role="group" aria-label="Color theme">
              {themes.map(({ value, label, icon: ThemeIcon }) => (
                <Tooltip key={value} content={label}>
                  <button
                    type="button"
                    aria-label={`${label} theme`}
                    aria-pressed={props.theme === value}
                    onClick={() => props.onThemeChange(value)}
                  >
                    <ThemeIcon size={18} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </Tooltip>
              ))}
            </div>
          </Setting>
          <Setting label="Editor color scheme">
            <SelectField
              className="select-field--settings"
              label="Editor color scheme"
              value={props.editorScheme}
              onChange={(value) => props.onEditorSchemeChange(value as EditorScheme)}
              options={editorSchemes.map((s) => ({ value: s.id, label: s.label }))}
            />
          </Setting>
        </>
      )}
      {section === "editor" && (
        <>
          <Setting label="Code size">
            <SelectField
              className="select-field--settings"
              label="Code font size"
              value={String(props.fontSize)}
              onChange={(value) => props.onFontSizeChange(Number(value))}
              options={[12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => ({
                value: String(size),
                label: `${size}px`,
              }))}
            />
          </Setting>
          <Setting label="Indentation">
            <SelectField
              className="select-field--settings"
              label="Indent size"
              value={String(props.tabSize)}
              onChange={(value) => props.onTabSizeChange(Number(value) as 2 | 4)}
              options={[
                { value: "2", label: "2 spaces" },
                { value: "4", label: "4 spaces" },
              ]}
            />
          </Setting>
          <Setting label="Wrap long lines" description="Keep long lines within the editor.">
            <Toggle label="Wrap long lines" checked={props.wrap} onChange={props.onWrapChange} />
          </Setting>
        </>
      )}
      {section === "shortcuts" && (
        <>
          <div className="shortcut-tiles">
            {Object.values(workspaceShortcuts).map((shortcut) => (
              <div className="shortcut-tile" key={shortcut.label}>
                <Icon name={shortcut.icon} />
                <span>{shortcut.label}</span>
                <div>
                  <ShortcutKeys keys={shortcut.keys} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {section === "drafts" && (
        <>
          <p className="settings-section-description">
            Drafts and history stay in this browser. Other windows keep their own active code.
          </p>
          <button
            className="settings-action"
            onClick={() => {
              props.onClose?.();
              props.onHistory?.();
            }}
          >
            <Icon name="history" />
            Browser history
            <Icon name="arrow" />
          </button>
          <label className="settings-action">
            <Icon name="history" />
            Import previous drafts
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void props.onImportDrafts?.(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button className="settings-action destructive-icon" onClick={props.onClearRecovery}>
            <Icon name="trash" />
            Clear browser drafts
          </button>
        </>
      )}
    </>
  );
}
