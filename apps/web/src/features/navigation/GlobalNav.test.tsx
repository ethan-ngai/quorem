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
import { currentMatchQueryKey } from "../matches/useActiveMatch";
import { GlobalNav } from "./GlobalNav";
import { AccountMenu } from "./AccountMenu";
import { developmentUserIds, type MatchSnapshot } from "@quorem/contracts";

async function renderNavigation(
  path: string,
  workspaceSettings?: SettingsProps,
  activeState?: MatchSnapshot["state"] | "pending",
  inParty = false,
  mode?: MatchSnapshot["mode"],
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path,
    component: () => (
      <GlobalNav identity="alice" workspaceSettings={workspaceSettings} mode={mode} />
    ),
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
    client.setQueryData(["current-party", "alice"], { party: inParty ? { id: "party" } : null });
    if (activeState !== "pending") {
      client.setQueryData(currentMatchQueryKey("alice"), {
        id: "current",
        state: activeState,
        participants: [{ userId: developmentUserIds.alice }],
      });
    }
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("global navigation", () => {
  it("does not show sign in while the account is unresolved", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AccountMenu pending failed={false} onOpenSettings={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="Checking account"');
    expect(html).not.toContain("Sign in");
  });
  it.each(["active", "finalizing"] as const)(
    "shows the return link from a cached %s snapshot",
    async (state) => {
      const html = await renderNavigation("/practice", undefined, state);
      expect(html).not.toContain('aria-label="Create match"');
      expect(html).toContain('href="/match/current"');
    },
  );
  it("keeps the lobby return action after the logo", async () => {
    const html = await renderNavigation("/practice", undefined, "completed", true);
    expect(html).toContain('href="/party"');
    expect(html.indexOf('aria-label="Quorem home"')).toBeLessThan(
      html.indexOf('aria-label="Return to lobby"'),
    );
    expect(html).not.toContain('aria-label="Create match"');
  });
  it.each(["/practice", "/party", "/invite/token", "/match/previous/review"])(
    "gives the active match priority over the lobby on %s",
    async (path) => {
      const html = await renderNavigation(path, undefined, "active", true);
      expect(html).toContain('aria-label="Return to match"');
      expect(html).toContain('href="/match/current"');
      expect(html).not.toContain('aria-label="Return to lobby"');
    },
  );
  it("omits both return actions in the active match workspace", async () => {
    const html = await renderNavigation("/match/current", undefined, "active", true, "showdown");
    expect(html).not.toContain('aria-label="Return to match"');
    expect(html).not.toContain('aria-label="Return to lobby"');
  });
  it("offers a lobby return from a completed match workspace", async () => {
    const html = await renderNavigation("/match/current", undefined, "completed", true, "showdown");
    expect(html).toContain('aria-label="Return to lobby"');
  });
  it("omits the lobby return action in the lobby", async () => {
    const html = await renderNavigation("/party/", undefined, "completed", true);
    expect(html).not.toContain('aria-label="Return to lobby"');
  });
  it("waits for match status before offering the lobby return", async () => {
    const html = await renderNavigation("/practice", undefined, "pending", true);
    expect(html).not.toContain('aria-label="Return to lobby"');
  });
  it("waits for the first HTTP snapshot before offering match creation", async () => {
    const html = await renderNavigation("/practice", undefined, "pending");
    expect(html).toContain('aria-label="Checking active match"');
    expect(html).not.toContain('aria-label="Create match"');
  });
  it("offers creation and named navigation/sign-in controls in practice", async () => {
    const html = await renderNavigation("/practice");
    expect(html).toContain('aria-label="Create match"');
    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("Guest");
    expect(html).not.toContain('aria-label="Profile"');
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html.indexOf('aria-label="Expand sidebar"')).toBeLessThan(
      html.indexOf('aria-label="Quorem home"'),
    );
  });
  it("places workspace settings immediately before the sign-in control", async () => {
    const html = await renderNavigation("/practice/example", {
      theme: "system",
      onThemeChange: () => {},
      editorSchemes: { light: "jetbrains-light", dark: "jetbrains-dark" },
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
  it.each(["/practice", "/invite/token", "/match/lobby", "/questions"])(
    "omits the workspace shortcut outside a question workspace: %s",
    async (path) => {
      expect(await renderNavigation(path)).not.toContain('aria-label="Workspace settings"');
    },
  );
  it.each(["/match/unavailable", "/invite/token"])("hides creation throughout %s", async (path) => {
    expect(await renderNavigation(path)).not.toContain('aria-label="Create match"');
  });
});
