/** @file AdminDashboard.test.tsx @description Overview content and truthful empty/history labels. @module admin */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AdminOverviewContent } from "./AdminDashboard";
import { overviewFixture } from "./overview.fixture";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search)}` : ""}`} {...props}>
      {children}
    </a>
  ),
}));

it("links shared draft updates to authoring and labels finite submission history", () => {
  const html = renderToStaticMarkup(<AdminOverviewContent data={overviewFixture} />);
  expect(html).toContain('href="/questions?section=drafts&amp;draft=fixture-draft-0"');
  expect(html).toContain("Older submissions may have expired.");
  expect(html).toContain("8 of 182");
  expect(html).toContain("Publication edit");
  expect(html).toContain("Disabled");
});

it("offers clear empty states with zero counts", () => {
  const html = renderToStaticMarkup(
    <AdminOverviewContent
      data={{
        ...overviewFixture,
        users: { accounts: 1, administrators: 1, disabled: 0, active7d: 0 },
        content: { publications: 0, drafts: 0, workspaces: 0 },
        submissions: { retained7d: 0, pending: 0 },
        activeUsers: [],
        recentDrafts: [],
      }}
    />,
  );
  expect(html).toContain("No account submissions in this period.");
  expect(html).toContain("No shared drafts.");
  expect(html).not.toContain("NaN");
});
