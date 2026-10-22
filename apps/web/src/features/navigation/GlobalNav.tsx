import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog";
import type { SettingsProps } from "../editor/components/WorkspaceSettings";
import { useSession } from "../auth/session";
import * as Popover from "@radix-ui/react-popover";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Home, Menu, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editor/editorSettings";
import { Brand } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { ModeIcon } from "../matches/MatchControls";
import { ModeText } from "../matches/ModeText";
import { useActiveMatch } from "../matches/useActiveMatch";
import { isMatchCreationRequest, matchSignInLocation } from "./matchCreationIntent";
import { AccountMenu } from "./AccountMenu";
import "./navigation.css";

export function GlobalNav({
  identity = "anonymous" as DevelopmentIdentity,
  mode,
  onCreateMatch,
  theme,
  onThemeChange,
  workspaceSettings,
  children,
}: {
  identity?: DevelopmentIdentity;
  slug?: string;
  mode?: "showdown" | "free-for-all";
  onCreateMatch?: () => void;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
  workspaceSettings?: SettingsProps;
  children?: ReactNode;
}) {
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const [settingsOpen, setSettingsOpen] = useState(false);
  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    setSettingsOpen(true);
    workspaceSettings?.onOpenChange?.(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    workspaceSettings?.onOpenChange?.(false);
  }
  const session = useSession();
  const actor = (session.data?.user.id ?? identity) as DevelopmentIdentity;
  const activeMatch = useActiveMatch(actor, !!session.data);
  const checkingMatch = session.isPending || activeMatch.checking;
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const consumedCreation = useRef(false);
  const inMatch = pathname.startsWith("/match/") || pathname.startsWith("/invite/");
  const [creating, setCreating] = useState(false);
  function signInToCreate() {
    const destination = matchSignInLocation(
      window.location.pathname + window.location.search + window.location.hash,
    );
    window.history.replaceState(window.history.state, "", destination.backTo);
    window.location.assign(destination.login);
  }
  useEffect(() => {
    if (!isMatchCreationRequest(pathname, location.search)) {
      consumedCreation.current = false;
      return;
    }
    if (consumedCreation.current) return;
    if (session.isPending) return;
    if (session.data && (activeMatch.checking || activeMatch.failed)) return;
    consumedCreation.current = true;
    if (!session.data) {
      signInToCreate();
      return;
    }
    if (activeMatch.match) {
      window.location.assign(`/match/${activeMatch.match.id}`);
      return;
    }
    setCreating(true);
    void navigate({
      to: "/practice",
      search: (previous) => {
        const { create: _create, ...filters } = previous;
        return filters;
      },
      replace: true,
    });
  }, [
    pathname,
    location.search,
    navigate,
    session.isPending,
    session.data,
    activeMatch.checking,
    activeMatch.failed,
    activeMatch.match,
  ]);
  return (
    <>
      <header className="topbar global-nav">
        <Brand />
        <nav className="global-nav-links" aria-label="Main navigation">
          <Popover.Root>
            <Tooltip content="Navigation">
              <Popover.Trigger asChild>
                <button className="icon-button nav-menu-trigger" aria-label="Navigation">
                  <Menu size={18} />
                </button>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content
                className="nav-popover nav-menu"
                align="start"
                sideOffset={8}
                collisionPadding={8}
                aria-label="Navigation"
              >
                <Popover.Close asChild>
                  <a href="/">
                    <Home size={17} />
                    Home
                  </a>
                </Popover.Close>
                {session.data?.user.role === "admin" && (
                  <Popover.Close asChild>
                    <a href="/admin/questions">
                      <BookOpen size={17} />
                      Question editor
                    </a>
                  </Popover.Close>
                )}
                <Popover.Close asChild>
                  <a
                    href="/practice"
                    aria-current={pathname.startsWith("/practice") ? "page" : undefined}
                  >
                    <BookOpen size={17} />
                    Practice
                  </a>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {mode ? (
            <span className="global-mode">
              <span key={mode} className="mode-icon-enter">
                <ModeIcon mode={mode} />
              </span>
              <ModeText mode={mode} showdown="Showdown" freeForAll="Free-for-all" />
            </span>
          ) : (
            !inMatch &&
            (activeMatch.match ? (
              <Tooltip content="Finish or leave your current match before creating another.">
                <a
                  className="quiet-button active-match-trigger"
                  aria-label={activeMatch.label ?? undefined}
                  href={`/match/${activeMatch.match.id}`}
                >
                  <ArrowRight size={18} />
                  <span>{activeMatch.label}</span>
                </a>
              </Tooltip>
            ) : (
              <Tooltip
                content={
                  activeMatch.failed
                    ? "Could not check your active match. Try again shortly."
                    : "Create match"
                }
              >
                <button
                  className="quiet-button create-match-trigger"
                  disabled={checkingMatch || activeMatch.failed}
                  aria-label={
                    checkingMatch
                      ? "Checking active match"
                      : activeMatch.failed
                        ? "Match status unavailable"
                        : "Create match"
                  }
                  onClick={() => {
                    if (!session.data) {
                      signInToCreate();
                      return;
                    }
                    (onCreateMatch ?? (() => setCreating(true)))();
                  }}
                >
                  <Plus size={18} />
                  <span>
                    {checkingMatch
                      ? "Checking match…"
                      : activeMatch.failed
                        ? "Match status unavailable"
                        : "Create match"}
                  </span>
                </button>
              </Tooltip>
            ))
          )}
        </nav>
        <div className="topbar-spacer" />
        {children}
        {workspaceSettings && (
          <Tooltip content="Workspace settings">
            <button
              className="icon-button"
              ref={settingsTrigger}
              aria-label="Workspace settings"
              onClick={() => openSettings("editor")}
            >
              <SlidersHorizontal size={18} />
            </button>
          </Tooltip>
        )}
        <AccountMenu
          triggerRef={profileTrigger}
          session={session.data}
          pending={session.isPending}
          failed={session.isError}
          onOpenSettings={openSettings}
        />
      </header>
      <SettingsDialog
        open={settingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={closeSettings}
        onReturnFocus={() => (settingsTrigger.current ?? profileTrigger.current)?.focus()}
        session={session.data}
        workspace={workspaceSettings}
        theme={theme ?? "system"}
        onThemeChange={onThemeChange ?? (() => {})}
      />
      {creating && <CreateMatchDialog onClose={() => setCreating(false)} identity={actor} />}
    </>
  );
}
