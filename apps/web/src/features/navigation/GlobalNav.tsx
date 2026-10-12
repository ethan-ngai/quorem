import * as Popover from "@radix-ui/react-popover";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpen, Home, Menu, Monitor, Moon, Plus, Sun, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import type { ThemePreference } from "../editor/editorSettings";
import { Brand } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { IdentityChoice, ModeIcon } from "../matches/MatchControls";
import { isMatchCreationRequest } from "./matchCreationIntent";
import "./navigation.css";

export function GlobalNav({
  identity,
  mode,
  onCreateMatch,
  onIdentityChange,
  identityDisabled,
  theme,
  onThemeChange,
  preferences,
  children,
}: {
  identity: DevelopmentIdentity;
  slug?: string;
  mode?: "showdown" | "free-for-all";
  onCreateMatch?: () => void;
  onIdentityChange?: (identity: DevelopmentIdentity) => void;
  identityDisabled?: boolean;
  theme?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
  preferences?: ReactNode;
  children?: ReactNode;
}) {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const consumedCreation = useRef(false);
  const inMatch = pathname.startsWith("/match/") || pathname.startsWith("/invite/");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!isMatchCreationRequest(pathname, location.search)) {
      consumedCreation.current = false;
      return;
    }
    if (consumedCreation.current) return;
    consumedCreation.current = true;
    setCreating(true);
    void navigate({ to: "/practice", search: {}, replace: true });
  }, [pathname, location.search, navigate]);
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
                  onClick={onCreateMatch ?? (() => setCreating(true))}
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
        <Popover.Root>
          <Tooltip content="Profile and preferences">
            <Popover.Trigger asChild>
              <button
                className="icon-button nav-profile-trigger"
                aria-label="Profile and preferences"
              >
                <UserRound size={18} />
              </button>
            </Popover.Trigger>
          </Tooltip>
          {/* Keep the nested settings dialog mounted when its popover closes. */}
          <Popover.Portal forceMount>
            <Popover.Content
              forceMount
              className="nav-popover nav-profile"
              align="end"
              sideOffset={8}
              collisionPadding={8}
              aria-label="Profile and preferences"
            >
              <h2>Local account</h2>
              {onIdentityChange ? (
                <IdentityChoice
                  identity={identity}
                  onChange={onIdentityChange}
                  disabled={identityDisabled}
                />
              ) : (
                <p>{identity}</p>
              )}
              {onThemeChange && (
                <div className="nav-theme" role="group" aria-label="Color theme">
                  {(
                    [
                      { value: "system", label: "System", Icon: Monitor },
                      { value: "light", label: "Light", Icon: Sun },
                      { value: "dark", label: "Dark", Icon: Moon },
                    ] as const
                  ).map(({ value, label, Icon }) => (
                    <Tooltip key={value} content={label}>
                      <button
                        className="icon-button"
                        aria-label={label}
                        aria-pressed={theme === value}
                        onClick={() => onThemeChange(value)}
                      >
                        <Icon size={18} />
                      </button>
                    </Tooltip>
                  ))}
                </div>
              )}
              {preferences && (
                <div className="nav-preferences">
                  {preferences}
                  <span>Workspace settings</span>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </header>
      {creating && <CreateMatchDialog onClose={() => setCreating(false)} identity={identity} />}
    </>
  );
}
