import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Session } from "../auth/session";
import { catalogSearch } from "./catalogSearch";
import { PracticeBrowser } from "./PracticeBrowser";

vi.mock("../editor/useTheme", () => ({
  useTheme: () => ({ preference: "dark", theme: "dark", setPreference: () => {} }),
}));

async function renderPractice(session: Session | null) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/practice",
    validateSearch: catalogSearch,
    component: PracticeBrowser,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/practice"] }),
  });
  await router.load();
  const client = new QueryClient();
  client.setQueryData(["auth-session"], session);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
const account: Session = {
  user: { id: "viewer", displayName: "Viewer", emailVerified: true, role: "user" },
  mode: "development",
};
it("hides the library selector for anonymous and ordinary accounts", async () => {
  for (const session of [null, account]) {
    const html = await renderPractice(session);
    expect(html).toContain("Practice");
    expect(html).toContain('aria-label="Question type"');
    expect(html).toContain('aria-label="SQL questions"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Odyssey"');
    expect(html).toContain('aria-label="Classic"');
    expect(html).not.toContain('aria-label="Question library"');
    expect(html).not.toContain('class="quiet-button" href="/admin/questions"');
  }
});
it("shows the library selector for admins and custom question authors", async () => {
  const capabilities: NonNullable<Session["capabilities"]> = {
    hostGuests: false,
    authorCustomQuestions: true,
    interviewConcurrency: 1,
    interviews: false,
    hostedIntelligence: false,
    experimental: false,
    guestConcurrency: 0,
  };
  for (const session of [
    { ...account, user: { ...account.user, role: "admin" as const } },
    { ...account, capabilities },
  ]) {
    const html = await renderPractice(session);
    expect(html).toContain('aria-label="Question library"');
    expect(html).toContain('aria-label="Private library"');
    expect(html).toContain('role="radio"');
    expect(html).not.toContain('class="quiet-button" href="/admin/questions"');
  }
});
