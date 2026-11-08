/** @file GlobalNav.tsx @description Shared sidebar with persistent top-bar identity and workspace controls. @module navigation */
import { catalogSearch } from "../practice/catalogSearch";
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog";
import type { SettingsProps } from "../editor/components/WorkspaceSettings";
import { canAccess } from "../auth/adminAccess";
import { useSession } from "../auth/session";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editor/editorSettings";
import { Tooltip } from "../../ui/Tooltip";
import { DelayedSpinner } from "../../ui/Spinner";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { ModeIcon } from "../matches/ModeIcon";
import { ModeText } from "../matches/ModeText";
import { useActiveMatch } from "../matches/useActiveMatch";
import { readPendingCommand } from "../matches/commandRecovery";
import { useParty } from "../matches/party";
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
  mode?: "showdown" | "free-for-all" | "factions";
  onCreateMatch?: () => void;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
  workspaceSettings?: SettingsProps;
  children?: ReactNode;
}) {
  const [compactActions, setCompactActions] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 620px)");
    const update = () => setCompactActions(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("settings")
      : null) === "social"
      ? "social"
      : "appearance",
  );
  const [settingsOpen, setSettingsOpen] = useState(
    () =>
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("settings")
        : null) === "social",
  );
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
  const location = useLocation();
  const pathname = location.pathname.replace(/\/$/, "") || "/";
  const navigate = useNavigate();
  const consumedCreation = useRef(false);
  const hideCreation = pathname.startsWith("/match/") || pathname.startsWith("/invite/");
  const activeMatch = useActiveMatch(actor, !!session.data);
  const party = useParty(actor, !!session.data);
  const checkingMatch =
    session.isPending || activeMatch.checking || (!!session.data && party.isPending);
  const currentMatch = activeMatch.match;
  const currentMatchPath = currentMatch ? `/match/${currentMatch.id}` : null;
  const returnMatch =
    currentMatch &&
    pathname !== currentMatchPath &&
    !(mode && pathname === `${currentMatchPath}/review`)
      ? currentMatch
      : null;
  const hasParty = !!session.data && !!party.data?.party;
  const returnLobby =
    !currentMatch &&
    !activeMatch.checking &&
    !activeMatch.failed &&
    hasParty &&
    pathname !== "/party";
  const returnLabel = returnMatch ? activeMatch.label : returnLobby ? "Return to lobby" : null;
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
    if (session.data && (checkingMatch || activeMatch.failed)) return;
    consumedCreation.current = true;
    if (!session.data || session.data.kind === "guest") {
      signInToCreate();
      return;
    }
    if (currentMatchPath) {
      window.location.assign(currentMatchPath);
      return;
    }
    if (hasParty && !readPendingCommand(actor, "party:/v1/parties")) {
      window.location.assign("/party");
      return;
    }
    setCreating(true);
    void navigate({
      to: "/practice",
      search: (previous) => {
        const { create: _create, ...filters } = previous;
        return catalogSearch(filters);
      },
      replace: true,
    });
  }, [
    pathname,
    location.search,
    navigate,
    session.isPending,
    session.data,
    checkingMatch,
    activeMatch.failed,
    currentMatchPath,
    hasParty,
    actor,
  ]);
  return (
    <>
      <div className="global-nav-slot">
        <header className="topbar global-nav">
          <WorkspaceSidebar
            pathname={pathname}
            admin={canAccess(session.data, "admin")}
            author={canAccess(session.data, "authoring")}
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
            {mode && (
              <span className="global-mode">
                <span key={mode} className="mode-icon-enter">
                  <ModeIcon mode={mode} />
                </span>
                <ModeText mode={mode} showdown="Showdown" freeForAll="Free-for-all" />
              </span>
            )}
            {returnLabel ? (
              <Tooltip content={returnLabel} disabled={!compactActions}>
                <Link
                  className="nav-match-action"
                  aria-label={returnLabel}
                  {...(returnMatch
                    ? { to: "/match/$id", params: { id: returnMatch.id } }
                    : { to: "/party" })}
                >
                  <ArrowRight size={18} />
                  <span>{returnLabel}</span>
                </Link>
              </Tooltip>
            ) : (
              !mode &&
              !hideCreation &&
              !currentMatch && (
                <Tooltip
                  disabled={!compactActions}
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
                    <DelayedSpinner
                      active={checkingMatch}
                      label="Checking active match"
                      fallback={<Plus size={16} aria-hidden="true" />}
                    />
                    <span>
                      {activeMatch.failed
                        ? "Match status unavailable"
                        : session.data?.kind === "guest"
                          ? "Sign in to create a match"
                          : "Create match"}
                    </span>
                  </button>
                </Tooltip>
              )
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
