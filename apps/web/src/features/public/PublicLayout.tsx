/** @file PublicLayout.tsx @description Quiet public-page frame, navigation, and appearance controls. @module public */
import { useEffect, type ReactNode } from "react";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { Brand } from "../../ui/Icon";
import { Tooltip } from "../../ui/Tooltip";
import { useTheme } from "../editor/useTheme";
import "./public.css";

export function PublicLayout({ title, children }: { title: string; children: ReactNode }) {
  const { theme, setPreference } = useTheme();
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Quorem`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <div className="public-page">
      <a className="public-skip" href="#main-content">
        Skip to content
      </a>
      <header className="public-header">
        <Brand />
        <div className="public-header-actions">
          <Tooltip content={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </Tooltip>
          <a className="button button-secondary" href="/practice">
            Open workspace <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
