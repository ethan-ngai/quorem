/** @file PageLayout.tsx @description Root page frame reserves footer space without covering the editor. @module navigation */
import { Outlet, useLocation } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { editorColorVariable, type EditorColorRole } from "../editor/editorColors";
import { resolveEditorPalette } from "../editor/editorPalettes";
import { PageMetadata } from "./PageMetadata";
import { SiteFooter } from "../../ui/SiteFooter";
import "./page-layout.css";
import { useSession } from "../auth/session";
import { useParty, usePlatformPresence } from "../matches/party";
import type { DevelopmentIdentity } from "@quorem/contracts";

export function PageLayout() {
  const session = useSession();
  const identity = (session.data?.user.id ?? "anonymous") as DevelopmentIdentity;
  usePlatformPresence(identity, !!session.data);
  useParty(identity, !!session.data, true);
  const pathname = useLocation({ select: (location) => location.pathname });
  const {
    editorSchemes: { light, dark },
  } = useLocalEditorPreferences();
  useLayoutEffect(() => {
    const lightColors = resolveEditorPalette(light, "light").colors;
    const darkColors = resolveEditorPalette(dark, "dark").colors;
    const root = document.documentElement;
    const roles = Object.keys(lightColors) as EditorColorRole[];
    // Root variables also reach menus rendered through a portal.
    for (const role of roles) {
      root.style.setProperty(
        editorColorVariable(role),
        `light-dark(${lightColors[role]}, ${darkColors[role]})`,
      );
    }
    return () => {
      for (const role of roles) root.style.removeProperty(editorColorVariable(role));
    };
  }, [light, dark]);
  return (
    <div className="page-layout">
      <PageMetadata />
      <div className="page-content">
        <Outlet />
      </div>
      <SiteFooter pathname={pathname} />
    </div>
  );
}
