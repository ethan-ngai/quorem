/** @file AccountMenu.tsx @description Profile menu and accessible account dialogs. @module navigation */
import { useErrorNotification } from "../../ui/Notifications";
import * as Popover from "@radix-ui/react-popover";
import { SquarePen, ChevronRight, LogOut, Settings, UserRound } from "lucide-react";
import { useState, type Ref } from "react";
import { signOut, type Session } from "../auth/session";
import { useProfile } from "../auth/profile";
import { Tooltip } from "../editor/components/Tooltip";
import { AccountAvatar } from "./AccountAvatar";

export function AccountMenu({
  session,
  pending,
  failed,
  onOpenSettings,
  triggerRef,
}: {
  triggerRef?: Ref<HTMLButtonElement>;
  session?: Session | null;
  pending: boolean;
  failed: boolean;
  onOpenSettings: (section: "profile" | "appearance") => void;
}) {
  const profile = useProfile(session?.kind === "guest" ? undefined : session?.user.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  const [saving, setSaving] = useState(false);
  const account = profile.data;
  const name = account?.name || account?.username || session?.user.displayName || "Account";
  function showPanel(next: "profile" | "appearance") {
    setOpen(false);
    onOpenSettings(next);
  }
  const returnTo =
    typeof location !== "undefined" &&
    /^\/(practice|match|invite|admin)(\/|$)/.test(location.pathname)
      ? `${location.pathname}${location.search}`
      : "";
  if (!session || session.kind === "guest")
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
            <button
              ref={triggerRef}
              className="icon-button nav-profile-trigger"
              aria-label="Profile"
            >
              <AccountAvatar name={name} username={account?.username} image={account?.image} />
            </button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content
            className="nav-popover nav-profile"
            align="end"
            side="bottom"
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
                    <button onClick={() => showPanel("appearance")}>
                      <Settings />
                      <span>Settings</span>
                    </button>
                  ) : null}
                  {session.user.role === "admin" ? (
                    <a href="/admin/questions">
                      <SquarePen />
                      <span>Question Editor</span>
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
    </>
  );
}
