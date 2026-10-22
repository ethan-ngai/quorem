import * as Dialog from "@radix-ui/react-dialog";
import { UserRound, ShieldCheck, X } from "lucide-react";
import { useRef } from "react";
import type { Session } from "../auth/session";
import type { ThemePreference } from "../editor/editorSettings";
import { Icon } from "../editor/components/Icon";
import {
  WorkspaceSettingsContent,
  workspaceSections,
  type SettingsProps,
  type WorkspaceSection,
} from "../editor/components/WorkspaceSettings";
import { ProfileSettings } from "./ProfileSettings";
import { useLocalEditorPreferences } from "./useLocalEditorPreferences";
import "./settings.css";

export type SettingsSection = WorkspaceSection | "profile" | "security";
export function SettingsDialog({
  open,
  section,
  onSectionChange,
  onClose,
  onReturnFocus,
  session,
  workspace,
  theme,
  onThemeChange,
}: {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onReturnFocus: () => void;
  session?: Session | null;
  workspace?: SettingsProps;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const local = useLocalEditorPreferences();
  const title =
    section === "profile"
      ? "Profile"
      : section === "security"
        ? "Security & login"
        : workspaceSections.find((item) => item.id === section)!.label;
  const accountSection = section === "profile" || section === "security";
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-backdrop" />
        <Dialog.Content
          className="settings-dialog unified-settings"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            sidebar.current?.querySelector<HTMLButtonElement>("[aria-current]")?.focus();
          }}
        >
          <header className="settings-header">
            <div>
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Description>Manage your account and preferences.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="Close settings">
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <div className="settings-body">
            <nav className="settings-sidebar" aria-label="Settings categories" ref={sidebar}>
              {session && (
                <div className="settings-category-group">
                  <span>Account</span>
                  <button
                    aria-current={section === "profile" ? "page" : undefined}
                    onClick={() => onSectionChange("profile")}
                  >
                    <UserRound />
                    Profile
                  </button>
                  <button
                    aria-current={section === "security" ? "page" : undefined}
                    onClick={() => onSectionChange("security")}
                  >
                    <ShieldCheck />
                    <span>Security & login</span>
                  </button>
                </div>
              )}
              <div className="settings-category-group">
                <span>On this device</span>
                {workspaceSections
                  .filter((item) => item.id !== "drafts" || workspace)
                  .map((item) => (
                    <button
                      key={item.id}
                      aria-current={section === item.id ? "page" : undefined}
                      onClick={() => onSectionChange(item.id)}
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </button>
                  ))}
              </div>
            </nav>
            <section
              className="settings-section"
              key={section}
              aria-labelledby="settings-section-title"
              tabIndex={0}
            >
              <h2 id="settings-section-title">{title}</h2>
              {!accountSection && (
                <p className="settings-local-note">Saved only in this browser.</p>
              )}
              {accountSection ? (
                session && <ProfileSettings userId={session.user.id} section={section} />
              ) : (
                <WorkspaceSettingsContent
                  {...(workspace ?? {
                    ...local,
                    theme,
                    onThemeChange,
                    onHistory: () => {},
                    onClearRecovery: () => {},
                    onImportDrafts: async () => {},
                  })}
                  section={section}
                  onClose={onClose}
                />
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
