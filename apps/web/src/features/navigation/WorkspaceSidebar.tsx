/** @file WorkspaceSidebar.tsx @description Full-height navigation overlay with a stationary workspace. @module navigation */
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Home, SquarePen, X } from "lucide-react";
import { useState } from "react";
import "./sidebar.css";

/** One modal lifecycle for desktop and mobile, including the closing animation. */
export function WorkspaceSidebar({ pathname, admin }: { pathname: string; admin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="icon-button sidebar-toggle"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="workspace-navigation"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M3 12h18M3 18h8" />
          </svg>
        </button>
      </Dialog.Trigger>
      <aside className="sidebar-peek">
        <SidebarLinks pathname={pathname} admin={admin} peek />
      </aside>
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
              <X size={20} />
            </Dialog.Close>
            <a className="nav-brand" href="/" aria-label="Quorem home">
              <span className="brand-mark" aria-hidden="true" />
            </a>
          </div>
          <SidebarLinks pathname={pathname} admin={admin} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shared links keep the desktop peek and modal navigation in sync. */
function SidebarLinks({
  pathname,
  admin,
  peek = false,
}: {
  pathname: string;
  admin: boolean;
  peek?: boolean;
}) {
  return (
    <nav aria-label={peek ? "Quick navigation" : "Main navigation"} className="sidebar-content">
      <p className="sidebar-group-label">Navigate</p>
      <a className="sidebar-link" href="/" aria-label="Home" title="Home">
        <Home size={17} />
        <span>Home</span>
      </a>
      <a
        className="sidebar-link"
        href="/practice"
        aria-label="Practice"
        title="Practice"
        aria-current={pathname.startsWith("/practice") ? "page" : undefined}
      >
        <BookOpen size={17} />
        <span>Practice</span>
      </a>
      {admin && (
        <a
          className="sidebar-link"
          href="/admin/questions"
          aria-label="Question Editor"
          title="Question Editor"
          aria-current={pathname.startsWith("/admin") ? "page" : undefined}
        >
          <SquarePen size={17} />
          <span>Question Editor</span>
        </a>
      )}
    </nav>
  );
}
