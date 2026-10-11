import * as Select from "@radix-ui/react-select";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronDown, Plus, Swords, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { api, requireData } from "../editor/api";
import { Brand } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import "./navigation.css";

export function GlobalNav({
  identity,
  slug,
  mode,
  onCreateMatch,
  children,
}: {
  identity: DevelopmentIdentity;
  slug?: string;
  mode?: "showdown" | "free-for-all";
  onCreateMatch?: () => void;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const catalog = useQuery({
    queryKey: ["public-problems", identity],
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problems");
      return requireData(data, error);
    },
    staleTime: 60_000,
  });
  return (
    <>
      <header className="topbar global-nav">
        <Brand />
        <nav className="global-nav-links" aria-label="Main navigation">
          <Select.Root
            value={slug ?? ""}
            onValueChange={(next) => void navigate({ to: "/$slug", params: { slug: next } })}
          >
            <Select.Trigger
              className="quiet-button practice-trigger"
              aria-label="Practice problems"
            >
              <BookOpen size={18} />
              <span>Practice</span>
              <Select.Icon>
                <ChevronDown size={14} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                className="settings-select-menu practice-menu"
                position="popper"
                sideOffset={8}
                collisionPadding={8}
              >
                <Select.Viewport>
                  {(catalog.data?.items ?? []).map((problem) => (
                    <Select.Item
                      className="settings-select-item"
                      key={problem.id}
                      value={problem.slug}
                    >
                      <Select.ItemText>{problem.title}</Select.ItemText>
                      <span className="nav-problem-difficulty">{problem.difficulty}</span>
                    </Select.Item>
                  ))}
                  {catalog.isPending && (
                    <span className="nav-catalog-message">Loading problems…</span>
                  )}
                  {catalog.isError && (
                    <button className="quiet-button" onClick={() => void catalog.refetch()}>
                      Retry problems
                    </button>
                  )}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          {mode ? (
            <span className="global-mode">
              {mode === "showdown" ? <Swords size={18} /> : <UsersRound size={18} />}
              <span>{mode === "showdown" ? "Showdown" : "Free-for-all"}</span>
            </span>
          ) : (
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
          )}
        </nav>
        <div className="topbar-spacer" />
        {children}
      </header>
      {creating && <CreateMatchDialog onClose={() => setCreating(false)} identity={identity} />}
    </>
  );
}
