/** @file PageLayout.tsx @description Root page frame reserves footer space without covering the editor. @module navigation */
import { Outlet, useLocation } from "@tanstack/react-router";
import { SiteFooter } from "../../ui/SiteFooter";
import "./page-layout.css";

export function PageLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="page-layout">
      <div className="page-content">
        <Outlet />
      </div>
      <SiteFooter pathname={pathname} />
    </div>
  );
}
