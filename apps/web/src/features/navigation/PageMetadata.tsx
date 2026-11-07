/** @file PageMetadata.tsx @description Keeps metadata in sync across client-side route transitions. @module navigation */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "@tanstack/react-router";
import { pageSeo, seoMarkup } from "../../../../../packages/ui/src/seo";

type TitleOverride = { pathname: string; title: string };
const PageTitleContext = createContext<((title?: string) => void) | undefined>(undefined);

/** Private content is eligible for the browser tab only. */
export function usePageTitle(title?: string) {
  const setTitle = useContext(PageTitleContext);
  useLayoutEffect(() => {
    if (!title || !setTitle) return;
    setTitle(title);
    return () => setTitle();
  }, [setTitle, title]);
}

/** @returns The route outlet with static metadata and an optional browser title. */
export function PageMetadata({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [override, setOverride] = useState<TitleOverride>();
  const setTitle = useCallback(
    (title?: string) => setOverride(title ? { pathname, title } : undefined),
    [pathname],
  );
  const title = override?.pathname === pathname ? override.title : pageSeo(pathname).title;
  useLayoutEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    const origin = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content;
    const html = new DOMParser().parseFromString(
      `<head>${seoMarkup(pathname, origin ? new URL(origin).origin : undefined)}</head>`,
      "text/html",
    );
    document.head.querySelector('link[rel="canonical"]')?.remove();
    document.head.querySelector('meta[property="og:url"]')?.remove();
    for (const element of html.head.querySelectorAll("meta, link")) {
      const attribute = element.hasAttribute("name")
        ? "name"
        : element.hasAttribute("property")
          ? "property"
          : "rel";
      const existing = document.head.querySelector(
        `${element.tagName}[${attribute}="${element.getAttribute(attribute)}"]`,
      );
      if (existing) existing.replaceWith(element);
      else document.head.append(element);
    }
  }, [pathname]);
  return <PageTitleContext.Provider value={setTitle}>{children}</PageTitleContext.Provider>;
}
