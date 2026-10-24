/** @file WorkspaceSidebar.tsx @description Responsive left navigation with a top-bar toggle. @module navigation */
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, CodeXml, Home, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip } from "../editor/components/Tooltip";
import "./sidebar.css";

/** Keeps desktop collapse preference separate from the transient mobile drawer. */
export function WorkspaceSidebar({
  pathname,
  admin,
  children,
}: {
  pathname: string;
  admin: boolean;
  children?: ReactNode;
}) {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("quorem.sidebar.open") !== "false";
    } catch {
      return true;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    function update() {
      setMobile(media.matches);
      setDrawerOpen(false);
    }
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const open = mobile ? drawerOpen : expanded;
  function toggle() {
    if (mobile) {
      setDrawerOpen(!drawerOpen);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem("quorem.sidebar.open", String(next));
    } catch {
      /* Storage may be unavailable. */
    }
  }
  const sidebar = (
    <aside
      id="workspace-navigation"
      className="workspace-sidebar"
      data-state={mobile || expanded ? "expanded" : "collapsed"}
    >
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
    </aside>
  );
  const toggleButton = (
    <button
      ref={trigger}
      className="icon-button sidebar-toggle"
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={open}
      aria-controls="workspace-navigation"
      onClick={toggle}
    >
      {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
    </button>
  );
  if (!mobile)
    return (
      <>
        <Tooltip content={open ? "Collapse sidebar" : "Expand sidebar"}>{toggleButton}</Tooltip>
        {sidebar}
      </>
    );
  return (
    <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
      <Dialog.Trigger asChild>{toggleButton}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sidebar-backdrop" />
        <Dialog.Content
          asChild
          aria-describedby={undefined}
          onCloseAutoFocus={() => trigger.current?.focus()}
        >
          <div className="sidebar-mobile-dialog">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close
              className="icon-button sidebar-mobile-close"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={18} />
            </Dialog.Close>
            {sidebar}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
