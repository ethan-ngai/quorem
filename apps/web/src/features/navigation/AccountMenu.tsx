/** @file AccountMenu.tsx @description Profile menu and accessible account dialogs. @module navigation */
import { authErrorMessage } from "../auth/errors";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  BookOpen,
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut, type Session } from "../auth/session";
import { useProfile, uploadProfilePhoto, removeProfilePhoto, photoTypes } from "../auth/profile";
import type { ThemePreference } from "../editor/editorSettings";
import { Tooltip } from "../editor/components/Tooltip";
import { AccountAvatar } from "./AccountAvatar";
import { ProfileEditor } from "../auth/ProfileEditor";
import { PasskeySettings } from "../auth/PasskeySettings";

type AccountPanel = "profile" | "settings";
export function AccountMenu({
  session,
  pending,
  failed,
  theme,
  onThemeChange,
}: {
  session?: Session | null;
  pending: boolean;
  failed: boolean;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
}) {
  const profile = useProfile(session?.user.id);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<AccountPanel | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const account = profile.data;
  const name = account?.name || account?.username || session?.user.displayName || "Account";
  function showPanel(next: AccountPanel) {
    setOpen(false);
    setError("");
    setPanel(next);
  }
  async function changePhoto(file?: File) {
    setSaving(true);
    setError("");
    try {
      const updated = file ? await uploadProfilePhoto(file) : await removeProfilePhoto();
      queryClient.setQueryData(["account-profile", session?.user.id], updated);
    } catch (cause) {
      setError(authErrorMessage(cause, "Photo update unavailable. Try again."));
    } finally {
      setSaving(false);
    }
  }
  const returnTo =
    typeof location !== "undefined" &&
    /^\/(practice|match|invite|admin)(\/|$)/.test(location.pathname)
      ? `${location.pathname}${location.search}`
      : "";
  if (!session)
    return (
      <a
        className="button nav-sign-in"
        href={returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login"}
      >
        Sign in
      </a>
    );
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip content="Profile">
          <Popover.Trigger asChild>
            <button className="icon-button nav-profile-trigger" aria-label="Profile">
              <AccountAvatar name={name} username={account?.username} image={account?.image} />
            </button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content
            className="nav-popover nav-profile"
            align="end"
            sideOffset={8}
            collisionPadding={8}
            aria-label="Account menu"
          >
            <div className="account-menu-header">
              <AccountAvatar
                name={name}
                username={account?.username}
                image={account?.image}
                large
              />
              <div className="account-menu-identity">
                <strong>{name}</strong>
                {account?.email ? (
                  <span title={account.email}>{account.email}</span>
                ) : (
                  <span>{session ? "Your account" : "Sign in to save your progress"}</span>
                )}
              </div>
            </div>
            {pending ? (
              <p className="account-menu-status" role="status">
                Checking account…
              </p>
            ) : failed ? (
              <p className="account-menu-status" role="alert">
                Account unavailable. Reload to retry.
              </p>
            ) : session ? (
              <>
                <div className="account-menu-rows">
                  <button onClick={() => showPanel("profile")}>
                    <UserRound />
                    <span>Profile</span>
                    <ChevronRight className="account-menu-chevron" />
                  </button>
                  {session ? (
                    <button onClick={() => showPanel("settings")}>
                      <Settings />
                      <span>Settings</span>
                    </button>
                  ) : null}
                  {session.user.role === "admin" ? (
                    <a href="/admin/questions">
                      <BookOpen />
                      <span>Question editor</span>
                    </a>
                  ) : null}
                </div>
                <div className="account-menu-footer">
                  <button
                    className="account-logout"
                    disabled={saving}
                    onClick={() => {
                      setSaving(true);
                      void signOut().catch(() => {
                        setError("Log out unavailable. Try again.");
                        setSaving(false);
                      });
                    }}
                  >
                    <LogOut />
                    <span>Log out</span>
                  </button>
                  {error ? <p role="alert">{error}</p> : null}
                </div>
              </>
            ) : (
              <div className="account-menu-rows">
                <a href="/login">
                  <UserRound />
                  <span>Sign in</span>
                  <ChevronRight className="account-menu-chevron" />
                </a>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Dialog.Root
        open={panel !== null}
        onOpenChange={(value) => {
          if (!value) setPanel(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="settings-backdrop" />
          <Dialog.Content className="account-dialog">
            <header className="account-dialog-header">
              <div>
                <Dialog.Title>{panel === "profile" ? "Profile" : "Account settings"}</Dialog.Title>
                <Dialog.Description>
                  {panel === "profile"
                    ? "Your account and profile photo."
                    : "Manage your sign-in methods and appearance."}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Close account dialog">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </header>
            {panel === "profile" ? (
              <>
                <div className="account-photo-editor">
                  <AccountAvatar
                    name={name}
                    username={account?.username}
                    image={account?.image}
                    large
                  />
                  <div>
                    <label
                      className={`button button-secondary account-upload${saving ? " is-disabled" : ""}`}
                    >
                      {" "}
                      {saving ? "Updating…" : "Upload photo"}
                      <input
                        type="file"
                        aria-label="Upload profile photo"
                        accept={photoTypes.join(",")}
                        disabled={saving}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (file) void changePhoto(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {account?.image ? (
                      <button
                        className="quiet-button"
                        disabled={saving}
                        onClick={() => void changePhoto()}
                      >
                        Remove photo
                      </button>
                    ) : null}
                    <p>JPEG, PNG or WebP · up to 5 MB</p>
                  </div>
                </div>
                {profile.isPending ? (
                  <p role="status">Loading profile…</p>
                ) : profile.isError ? (
                  <p role="alert">
                    Profile unavailable.{" "}
                    <button className="quiet-button" onClick={() => void profile.refetch()}>
                      Retry
                    </button>
                  </p>
                ) : null}
                {account && <ProfileEditor profile={account} userId={session.user.id} />}
                {error ? (
                  <p className="account-error" role="alert">
                    {error}
                  </p>
                ) : null}
              </>
            ) : panel === "settings" ? (
              <>
                <PasskeySettings />
                {onThemeChange ? (
                  <div className="account-theme-setting">
                    <span>Color theme</span>
                    <div className="theme-segments" role="group" aria-label="Color theme">
                      {(
                        [
                          { value: "system", label: "System", Icon: Monitor },
                          { value: "light", label: "Light", Icon: Sun },
                          { value: "dark", label: "Dark", Icon: Moon },
                        ] as const
                      ).map(({ value, label, Icon }) => (
                        <Tooltip key={value} content={label}>
                          <button
                            aria-label={`${label} theme`}
                            aria-pressed={theme === value}
                            onClick={() => onThemeChange?.(value)}
                          >
                            <Icon size={18} />
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
