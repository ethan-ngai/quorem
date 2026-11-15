/** @file PageLayout.tsx @description Root page frame reserves footer space without covering the editor. @module navigation */
import { Outlet, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { EditorAppearance } from "../editor/EditorAppearance";
import { PageMetadata } from "./PageMetadata";
import { SiteFooter } from "../../ui/SiteFooter";
import "./page-layout.css";
import { useSession } from "../auth/session";
import { useParty, usePlatformPresence } from "../matches/party";
import { currentMatchQueryKey } from "../matches/useActiveMatch";
import type { DevelopmentIdentity } from "@quorem/contracts";

export function PageLayout() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    function measureGutter() {
      // Keep the unlocked width while a modal temporarily removes the native gutter.
      if (document.body.hasAttribute("data-scroll-locked")) return;
      const width = window.innerWidth - root.getBoundingClientRect().width;
      root.style.setProperty("--viewport-gutter-width", `${Math.max(0, width)}px`);
    }
    measureGutter();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measureGutter);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, []);
  const session = useSession();
  const identity = (session.data?.user.id ?? "anonymous") as DevelopmentIdentity;
  usePlatformPresence(identity, !!session.data);
  const { data: membership } = useParty(identity, !!session.data, true);
  const currentMatchId = membership?.party?.currentMatchId;
  const queryClient = useQueryClient();
  useEffect(() => {
    // Lobby polling sees round changes even while the player is on another page.
    void queryClient.invalidateQueries(
      { queryKey: currentMatchQueryKey(identity), exact: true },
      { cancelRefetch: false },
    );
  }, [queryClient, identity, currentMatchId]);
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="page-layout">
      <EditorAppearance />
      <div className="page-content">
        <PageMetadata>
          <Outlet />
        </PageMetadata>
      </div>
      <SiteFooter pathname={pathname} />
    </div>
  );
}
