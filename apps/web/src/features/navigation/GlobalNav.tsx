import { useSession } from "../auth/session";
import * as Popover from "@radix-ui/react-popover";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpen, Home, Menu, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editor/editorSettings";
import { Brand } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { ModeIcon } from "../matches/MatchControls";
import { isMatchCreationRequest, matchSignInLocation } from "./matchCreationIntent";
import { AccountMenu } from "./AccountMenu";
import "./navigation.css";

export function GlobalNav({
  identity = "anonymous" as DevelopmentIdentity,
  mode,
  onCreateMatch,
  theme,
  onThemeChange,
  preferences,
  children,
}: {
  identity?: DevelopmentIdentity;
  slug?: string;
  mode?: "showdown" | "free-for-all";
  onCreateMatch?: () => void;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
  preferences?: ReactNode;
  children?: ReactNode;
}) {
  const session = useSession();
  const actor = (session.data?.user.id ?? identity) as DevelopmentIdentity;
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
    consumedCreation.current = true;
    if (!session.data) {
      signInToCreate();
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
  }, [pathname, location.search, navigate, session.isPending, session.data]);
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
              <ModeIcon mode={mode} />
              <span>{mode === "showdown" ? "Showdown" : "Free-for-all"}</span>
            </span>
          ) : (
            !inMatch && (
              <Tooltip content="Create match">
                <button
                  className="quiet-button create-match-trigger"
                  aria-label="Create match"
                  onClick={() => {
                    if (!session.data) {
                      signInToCreate();
                      return;
                    }
                    (onCreateMatch ?? (() => setCreating(true)))();
                  }}
                >
                  <Plus size={18} />
                  <span>Create match</span>
                </button>
              </Tooltip>
            )
          )}
        </nav>
        <div className="topbar-spacer" />
        {children}
        {preferences}
        <AccountMenu
          session={session.data}
          pending={session.isPending}
          failed={session.isError}
          theme={theme}
          onThemeChange={onThemeChange}
        />
      </header>
      {creating && <CreateMatchDialog onClose={() => setCreating(false)} identity={actor} />}
    </>
  );
}
