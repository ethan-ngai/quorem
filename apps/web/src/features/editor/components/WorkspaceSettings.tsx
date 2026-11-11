/** @file WorkspaceSettings.tsx @description Shared local preference sections and accessible controls. @module editor */
import { ToggleSwitch as Toggle } from "../../../ui/ToggleSwitch";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { SelectField } from "../../../ui/SelectField";
import { editorFontSizes, type ThemePreference } from "../editorSettings";
import {
  editorSchemesForMode,
  type EditorScheme,
  type EditorMode,
  type EditorSchemePreferences,
} from "../editorSchemes";
import { workspaceShortcuts } from "../workspaceShortcuts";
import { ShortcutKeys } from "../../../ui/ShortcutKeys";
import { Icon } from "../../../ui/Icon";

import { SegmentedControl } from "../../../ui/SegmentedControl";

export type SettingsProps = {
  onOpenChange?: (open: boolean) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  editorSchemes: EditorSchemePreferences;
  onEditorSchemeChange: (mode: EditorMode, scheme: EditorScheme) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  tabSize: 2 | 4;
  onTabSizeChange: (size: 2 | 4) => void;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
};

export const workspaceSections = [
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "editor", label: "Editor", icon: "code" },
  { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
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

export type WorkspaceSection = (typeof workspaceSections)[number]["id"];

export function WorkspaceSettingsContent({
  section,
  ...props
}: SettingsProps & { section: WorkspaceSection }) {
  return (
    <>
      {section === "appearance" && (
        <>
          <Setting label="Color theme">
            <SegmentedControl
              label="Color theme"
              value={props.theme}
              onChange={props.onThemeChange}
              iconOnly
              options={themes.map(({ value, label, icon: ThemeIcon }) => ({
                value,
                label: `${label} theme`,
                icon: <ThemeIcon size={18} strokeWidth={1.5} aria-hidden="true" />,
              }))}
            />
          </Setting>
          {(["light", "dark"] as const).map((mode) => (
            <Setting
              key={mode}
              label={`${mode === "light" ? "Light" : "Dark"} editor theme`}
              description={`Used when appearance is ${mode}.`}
            >
              <SelectField
                className="select-field--settings"
                label={`${mode === "light" ? "Light" : "Dark"} editor theme`}
                value={props.editorSchemes[mode]}
                onChange={(value) => props.onEditorSchemeChange(mode, value as EditorScheme)}
                options={editorSchemesForMode(mode).map((s) => ({ value: s.id, label: s.label }))}
              />
            </Setting>
          ))}
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
              options={editorFontSizes.map((size) => ({
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
    </>
  );
}
