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
import type { SettingsProps } from "../editor/components/WorkspaceSettings";
import { GlobalNav } from "./GlobalNav";

async function renderNavigation(path: string, workspaceSettings?: SettingsProps) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path,
    component: () => <GlobalNav identity="alice" workspaceSettings={workspaceSettings} />,
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
    const html = await renderNavigation("/practice/example", {
      theme: "system",
      onThemeChange: () => {},
      editorScheme: "workspace",
      onEditorSchemeChange: () => {},
      fontSize: 15,
      onFontSizeChange: () => {},
      tabSize: 4,
      onTabSizeChange: () => {},
      wrap: false,
      onWrapChange: () => {},
      onHistory: () => {},
      onClearRecovery: () => {},
      onImportDrafts: async () => {},
    });
    expect(html).toContain('aria-label="Workspace settings"');
    expect(html.indexOf('aria-label="Workspace settings"')).toBeLessThan(
      html.indexOf('href="/login"'),
    );
    expect(html).not.toContain("nav-preferences");
  });
  it.each(["/practice", "/invite/token", "/match/lobby", "/admin/questions"])(
    "omits the workspace shortcut outside a question workspace: %s",
    async (path) => {
      expect(await renderNavigation(path)).not.toContain('aria-label="Workspace settings"');
    },
  );
  it.each(["/match/unavailable", "/invite/token"])("hides creation throughout %s", async (path) => {
    expect(await renderNavigation(path)).not.toContain('aria-label="Create match"');
  });
});
