/** @file WorkspaceSettings.tsx @description Modal preferences with section navigation and accessible controls. @module editor */
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { useRef, useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editorSettings";
import { editorSchemes, type EditorScheme } from "../editorPalette";
import { workspaceShortcuts } from "../workspaceShortcuts";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

type SettingsProps = {
  onOpenChange?: (open: boolean) => void;
  identity: DevelopmentIdentity;
  onIdentityChange: (identity: DevelopmentIdentity) => void;
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
  shortcuts: boolean;
  onShortcutsChange: (enabled: boolean) => void;
  onHistory: () => void;
  onClearRecovery: () => void;
};

const sections = [
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "editor", label: "Editor", icon: "code" },
  { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
  { id: "drafts", label: "Drafts", icon: "history" },
  { id: "account", label: "Local account", icon: "people" },
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

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className="settings-select" aria-label={label}>
        <Select.Value />
        <Select.Icon>
          <Icon name="chevron" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="settings-select-menu"
          position="popper"
          sideOffset={5}
          collisionPadding={12}
        >
          <Select.ScrollUpButton className="select-scroll">↑</Select.ScrollUpButton>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item className="settings-select-item" key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Icon name="submit" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll">↓</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
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

export function WorkspaceSettings(props: SettingsProps) {
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("appearance");
  const current = sections.find((item) => item.id === section)!;
  function changeOpen(value: boolean) {
    setOpen(value);
    props.onOpenChange?.(value);
  }
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Tooltip content="Workspace settings">
        <Dialog.Trigger asChild>
          <button className="icon-button" aria-label="Workspace settings">
            <Icon name="settings" />
          </button>
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Portal>
        <Dialog.Overlay className="settings-backdrop" />
        <Dialog.Content
          className="settings-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            sidebar.current?.querySelector<HTMLButtonElement>("button[aria-current]")?.focus();
          }}
        >
          <header className="settings-header">
            <div>
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Description>Preferences save on this device.</Dialog.Description>
            </div>
            <Tooltip content="Close settings">
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Close settings">
                  <Icon name="close" />
                </button>
              </Dialog.Close>
            </Tooltip>
          </header>
          <div className="settings-body">
            <nav className="settings-sidebar" aria-label="Settings sections" ref={sidebar}>
              {sections.map((item) => (
                <button
                  key={item.id}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </nav>
            <section
              className="settings-section"
              key={section}
              aria-labelledby="settings-section-title"
            >
              <h2 id="settings-section-title">
                <Icon name={current.icon} />
                {current.label}
              </h2>
              {section === "appearance" && (
                <>
                  <Setting label="Color theme" description="Follow your device or choose a theme.">
                    <Choice
                      label="Color theme"
                      value={props.theme}
                      onChange={(value) => props.onThemeChange(value as ThemePreference)}
                      options={[
                        { value: "system", label: "System" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ]}
                    />
                  </Setting>
                  <Setting label="Editor color scheme">
                    <Choice
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
                    <Choice
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
                    <Choice
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
                    <Toggle
                      label="Wrap long lines"
                      checked={props.wrap}
                      onChange={props.onWrapChange}
                    />
                  </Setting>
                </>
              )}
              {section === "shortcuts" && (
                <>
                  <Setting
                    label="Keyboard shortcuts"
                    description="Run, submit, and save from the editor."
                  >
                    <Toggle
                      label="Keyboard shortcuts"
                      checked={props.shortcuts}
                      onChange={props.onShortcutsChange}
                    />
                  </Setting>
                  <div className="shortcut-tiles" data-enabled={props.shortcuts}>
                    {Object.values(workspaceShortcuts).map((shortcut) => (
                      <div className="shortcut-tile" key={shortcut.label}>
                        <Icon name={shortcut.icon} />
                        <span>{shortcut.label}</span>
                        <div>
                          {shortcut.keys.map((key) => (
                            <kbd key={key}>{key}</kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {section === "drafts" && (
                <>
                  <p className="settings-section-description">
                    Saved versions and local recovery for this account.
                  </p>
                  <button
                    className="settings-action"
                    onClick={() => {
                      changeOpen(false);
                      props.onHistory();
                    }}
                  >
                    <Icon name="history" />
                    Draft history
                    <Icon name="arrow" />
                  </button>
                  <button
                    className="settings-action destructive-icon"
                    onClick={props.onClearRecovery}
                  >
                    <Icon name="trash" />
                    Clear local recovery
                  </button>
                </>
              )}
              {section === "account" && (
                <>
                  <Setting
                    label="Development identity"
                    description="Separate drafts and match seats for each account."
                  >
                    <Choice
                      label="Local development identity"
                      value={props.identity}
                      onChange={(value) => props.onIdentityChange(value as DevelopmentIdentity)}
                      options={[
                        { value: "alice", label: "Alice" },
                        { value: "bob", label: "Bob" },
                      ]}
                    />
                  </Setting>
                </>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
