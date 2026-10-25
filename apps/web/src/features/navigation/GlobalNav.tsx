/** @file GlobalNav.tsx @description Shared sidebar with persistent top-bar identity and workspace controls. @module navigation */
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog";
import type { SettingsProps } from "../editor/components/WorkspaceSettings";
import { useSession } from "../auth/session";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editor/editorSettings";
import { Tooltip } from "../editor/components/Tooltip";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { ModeIcon } from "../matches/MatchControls";
import { ModeText } from "../matches/ModeText";
import { useActiveMatch } from "../matches/useActiveMatch";
import { isMatchCreationRequest, matchSignInLocation } from "./matchCreationIntent";
import { AccountMenu } from "./AccountMenu";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
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
    if (!session.data || session.data.kind === "guest") {
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
      <div className="global-nav-slot">
        <header className="topbar global-nav">
          <WorkspaceSidebar
            pathname={pathname}
            admin={
              session.data?.user.role === "admin" ||
              !!(
                session.data?.capabilities &&
                "authorCustomQuestions" in session.data.capabilities &&
                session.data.capabilities.authorCustomQuestions === true
              )
            }
            interviews={!!session.data?.capabilities?.interviews}
          />
          <a className="nav-brand" href="/" aria-label="Quorem home">
            <span className="brand-mark" aria-hidden="true" />
          </a>
          <div className="nav-actions">
            {children}

            {workspaceSettings && (
              <Tooltip content="Workspace settings">
                <button
                  className="icon-button nav-settings-trigger"
                  ref={settingsTrigger}
                  aria-label="Workspace settings"
                  onClick={() => openSettings("editor")}
                >
                  <SlidersHorizontal size={18} />
                </button>
              </Tooltip>
            )}
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
                  <Link
                    className="nav-match-action active-match-trigger"
                    aria-label={activeMatch.label ?? undefined}
                    to="/match/$id"
                    params={{ id: activeMatch.match.id }}
                  >
                    <ArrowRight size={18} />
                    <span>{activeMatch.label}</span>
                  </Link>
                </Tooltip>
              ) : (
                <Tooltip
                  content={
                    activeMatch.failed
                      ? "Could not check your active match. Try again shortly."
                      : session.data?.kind === "guest"
                        ? "Sign in to create a match"
                        : "Create match"
                  }
                >
                  <button
                    className="nav-match-action create-match-trigger"
                    disabled={checkingMatch || activeMatch.failed}
                    aria-label={
                      checkingMatch
                        ? "Checking active match"
                        : activeMatch.failed
                          ? "Match status unavailable"
                          : session.data?.kind === "guest"
                            ? "Sign in to create a match"
                            : "Create match"
                    }
                    onClick={() => {
                      if (!session.data || session.data.kind === "guest") {
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
                          : session.data?.kind === "guest"
                            ? "Sign in to create a match"
                            : "Create match"}
                    </span>
                  </button>
                </Tooltip>
              ))
            )}
            <AccountMenu
              triggerRef={profileTrigger}
              session={session.data}
              pending={session.isPending}
              failed={session.isError}
              onOpenSettings={openSettings}
            />
          </div>
        </header>
      </div>
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
