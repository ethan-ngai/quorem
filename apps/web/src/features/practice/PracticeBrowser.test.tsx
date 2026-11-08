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

async function renderPractice(
  session: Session | null,
  initialUrl = "/practice",
  client = new QueryClient(),
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/practice",
    validateSearch: catalogSearch,
    component: PracticeBrowser,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  await router.load();
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
    expect(html).toContain('aria-label="Question category"');
    expect(html).toContain('aria-label="Algorithms" aria-checked="true"');
    expect(html).toContain('aria-label="SQL" aria-checked="false"');
    expect(html).toContain('aria-label="Classic" aria-checked="true"');
    expect(html).toContain('aria-label="Odyssey" aria-checked="false"');
    expect(html).not.toContain('aria-label="All question types"');
    expect(html).not.toContain('aria-label="Question library"');
    expect(html).not.toContain('class="quiet-button" href="/questions"');
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
    expect(html).not.toContain('class="quiet-button" href="/questions"');
  }
});

it("keeps the catalog unranked when opening an old recommendation bookmark", async () => {
  const client = new QueryClient();
  const html = await renderPractice(account, "/practice?sort=recommended", client);
  expect(html).not.toContain("Question discovery");
  expect(
    client.getQueriesData({ queryKey: ["public-problems"] }).map(([key]) => key.at(-1)),
  ).toEqual([expect.objectContaining({ limit: 20 })]);
  expect(client.getQueriesData({ queryKey: ["public-problems"] })[0][0].at(-1)).not.toHaveProperty(
    "sort",
  );
  expect(
    client.getQueriesData({ queryKey: ["recommended-problems"] }).map(([key]) => key.at(-1)),
  ).toEqual([expect.objectContaining({ sort: "recommended", limit: 5 })]);
});

it("scopes both recommendations and rows to a bookmarked SQL Odyssey catalog", async () => {
  const client = new QueryClient();
  const html = await renderPractice(account, "/practice?sql=%22true%22&type=odyssey", client);
  expect(html).toContain('aria-label="SQL" aria-checked="true"');
  expect(html).toContain('aria-label="Odyssey" aria-checked="true"');
  for (const scope of ["public-problems", "recommended-problems"]) {
    const [query] = client.getQueriesData({ queryKey: [scope] });
    expect(query?.[0].at(-1)).toMatchObject({ sql: "true", type: "odyssey" });
  }
});
