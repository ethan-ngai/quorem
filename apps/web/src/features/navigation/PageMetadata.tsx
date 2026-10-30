/** @file PageMetadata.tsx @description Keeps metadata in sync across client-side route transitions. @module navigation */
import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { seoMarkup } from "../../../../../packages/ui/src/seo";

export function PageMetadata() {
  const pathname = useLocation({ select: (location) => location.pathname });
  useEffect(() => {
    const origin = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content;
    const html = new DOMParser().parseFromString(
      seoMarkup(pathname, origin ? new URL(origin).origin : undefined),
      "text/html",
    );
    document.title = html.title;
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
  return null;
}
