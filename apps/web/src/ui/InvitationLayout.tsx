/** @file InvitationLayout.tsx @description Shared invitation preview surface. @module ui */
import type { ReactNode } from "react";
export function InvitationLayout({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="match-page">
      <meta name="referrer" content="no-referrer" />
      {navigation}
      <section className="match-page-content">{children}</section>
    </main>
  );
}
