/** @file WorkspaceSidebar.tsx @description In-place desktop rail expansion and a mobile navigation drawer. @module navigation */
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Home, SquarePen, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./sidebar.css";
import { Tooltip } from "../../ui/Tooltip";

/** Desktop keeps the same rail mounted; mobile uses a modal drawer. */
export function WorkspaceSidebar({
  pathname,
  admin,
  interviews = false,
}: {
  pathname: string;
  admin: boolean;
  interviews?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    function update() {
      setMobile(media.matches);
      setOpen(false);
    }
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (mobile || !open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        desktopTrigger.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobile, open]);
  if (!mobile)
    return (
      <>
        <span className="sidebar-toggle-slot" aria-hidden="true" />
        <div
          className="sidebar-desktop-backdrop"
          data-state={open ? "open" : "closed"}
          aria-hidden="true"
          onPointerDown={() => setOpen(false)}
        />
        <aside className="sidebar-peek" data-expanded={open}>
          <div className="sidebar-header">
            <button
              ref={desktopTrigger}
              className="icon-button sidebar-toggle"
              aria-label={open ? "Close navigation" : "Open navigation"}
              aria-expanded={open}
              aria-controls="desktop-navigation"
              onClick={() => setOpen(!open)}
            >
              <NavigationToggleIcon open={open} />
            </button>
          </div>
          <SidebarLinks
            pathname={pathname}
            admin={admin}
            interviews={interviews}
            peek={!open}
            id="desktop-navigation"
          />
        </aside>
      </>
    );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="icon-button sidebar-toggle"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="workspace-navigation"
        >
          <NavigationToggleIcon open={open} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sidebar-backdrop" />
        <Dialog.Content
          id="workspace-navigation"
          className="workspace-sidebar"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="sidebar-header">
            <Dialog.Close className="icon-button sidebar-toggle" aria-label="Close navigation">
              <NavigationToggleIcon open={open} />
            </Dialog.Close>
            <a className="nav-brand" href="/" aria-label="Quorem home">
              <span className="brand-mark" aria-hidden="true" />
            </a>
          </div>
          <SidebarLinks pathname={pathname} admin={admin} interviews={interviews} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shared links keep the desktop peek and modal navigation in sync. */
function SidebarLinks({
  pathname,
  admin,
  interviews,
  peek = false,
  id,
}: {
  pathname: string;
  admin: boolean;
  interviews?: boolean;
  peek?: boolean;
  id?: string;
}) {
  return (
    <nav
      id={id}
      aria-label={peek ? "Quick navigation" : "Main navigation"}
      className="sidebar-content"
    >
      {[
        { href: "/", label: "Home", icon: Home, active: pathname === "/" },
        {
          href: "/practice",
          label: "Practice",
          icon: BookOpen,
          active: pathname.startsWith("/practice"),
        },
        ...(interviews
          ? [
              {
                href: "/interviews",
                label: "Interviews",
                icon: Users,
                active: pathname.startsWith("/interview"),
              },
            ]
          : []),
        ...(admin
          ? [
              {
                href: "/admin/questions",
                label: "Question Editor",
                icon: SquarePen,
                active: pathname.startsWith("/admin"),
              },
            ]
          : []),
      ].map(({ href, label, icon: LinkIcon, active }) => (
        <Tooltip key={href} content={label} side="right" disabled={!peek}>
          <a
            className="sidebar-link"
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <LinkIcon size={17} />
            <span>{label}</span>
          </a>
        </Tooltip>
      ))}
    </nav>
  );
}

/** Persistent strokes interpolate between the menu and close shapes. */
function NavigationToggleIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="navigation-toggle-icon"
      data-open={open}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path className="toggle-stroke-top" d="M3 12h18" />
      <path className="toggle-stroke-middle" d="M3 12h18" />
      <path className="toggle-stroke-bottom" d="M3 12h18" />
    </svg>
  );
}
