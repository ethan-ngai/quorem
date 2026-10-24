/** @file WorkspaceSidebar.tsx @description Full-height navigation overlay with a stationary workspace. @module navigation */
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, CodeXml, Home, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import "./sidebar.css";

/** One modal lifecycle for desktop and mobile, including the closing animation. */
export function WorkspaceSidebar({
  pathname,
  admin,
  children,
}: {
  pathname: string;
  admin: boolean;
  children?: ReactNode;
}) {
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
          <PanelLeftOpen size={18} />
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
              <PanelLeftClose size={18} />
            </Dialog.Close>
            <a className="nav-brand" href="/" aria-label="Quorem home">
              <span className="brand-mark" aria-hidden="true" />
              <span className="nav-wordmark" aria-hidden="true">
                Quorem
              </span>
            </a>
          </div>
          <nav aria-label="Main navigation" className="sidebar-content">
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
                aria-label="Question editor"
                title="Question editor"
                aria-current={pathname.startsWith("/admin") ? "page" : undefined}
              >
                <CodeXml size={17} />
                <span>Question editor</span>
              </a>
            )}
            <div className="sidebar-match-actions">{children}</div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
