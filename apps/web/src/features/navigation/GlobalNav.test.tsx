import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { GlobalNav } from "./GlobalNav";

async function renderNavigation(path: string, preferences?: ReactNode) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path,
    component: () => <GlobalNav identity="alice" preferences={preferences} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("global navigation", () => {
  it("offers creation and named navigation/sign-in controls in practice", async () => {
    const html = await renderNavigation("/practice");
    expect(html).toContain('aria-label="Create match"');
    expect(html).toContain('aria-label="Navigation"');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("Guest");
    expect(html).not.toContain('aria-label="Profile"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('aria-label="Practice problems"');
  });
  it("places workspace settings immediately before the sign-in control", async () => {
    const html = await renderNavigation(
      "/practice",
      <button aria-label="Workspace settings">Preferences</button>,
    );
    expect(html.indexOf('aria-label="Workspace settings"')).toBeLessThan(
      html.indexOf('href="/login"'),
    );
    expect(html).not.toContain("nav-preferences");
  });
  it.each(["/match/unavailable", "/invite/token"])("hides creation throughout %s", async (path) => {
    expect(await renderNavigation(path)).not.toContain('aria-label="Create match"');
  });
});
