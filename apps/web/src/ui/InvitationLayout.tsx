/** @file InvitationLayout.tsx @description Shared invitation preview surface. @module ui */
import type { ReactNode } from "react";
export function InvitationLayout({
  navigation,
  children,
  contentClassName,
}: {
  navigation: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <main className="match-page">
      <meta name="referrer" content="no-referrer" />
      {navigation}
      <section
        className={
          contentClassName ? `match-page-content ${contentClassName}` : "match-page-content"
        }
      >
        {children}
      </section>
    </main>
  );
}
