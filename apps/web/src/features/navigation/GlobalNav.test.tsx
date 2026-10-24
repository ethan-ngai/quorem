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
import { developmentUserIds, type MatchSnapshot } from "@quorem/contracts";

async function renderNavigation(
  path: string,
  workspaceSettings?: SettingsProps,
  activeState?: MatchSnapshot["state"],
) {
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
  const client = new QueryClient();
  client.setQueryData(["auth-session"], null);
  if (activeState) {
    client.setQueryData(["auth-session"], {
      user: { id: "alice", displayName: "Alice", emailVerified: true, role: "user" },
      mode: "development",
    });
    client.setQueryData(["current-match", "alice"], {
      id: "current",
      state: activeState,
      participants: [{ userId: developmentUserIds.alice }],
    });
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("global navigation", () => {
  it.each(["waiting", "ready", "active", "finalizing"] as const)(
    "replaces creation for %s membership",
    async (state) => {
      const html = await renderNavigation("/practice", undefined, state);
      expect(html).not.toContain('aria-label="Create match"');
      expect(html).toContain('href="/match/current"');
      expect(html).toContain(
        state === "waiting" || state === "ready"
          ? "Return to active lobby"
          : "Return to active match",
      );
    },
  );
  it("offers creation and named navigation/sign-in controls in practice", async () => {
    const html = await renderNavigation("/practice");
    expect(html).toContain('aria-label="Create match"');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("Guest");
    expect(html).not.toContain('aria-label="Profile"');
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="Practice"');
    expect(html).toContain('aria-label="Collapse sidebar"');
    expect(html.indexOf('aria-label="Collapse sidebar"')).toBeLessThan(
      html.indexOf('aria-label="Quorem home"'),
    );
    expect(html).toContain('aria-current="page"');
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
