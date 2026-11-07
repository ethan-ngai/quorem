// @vitest-environment happy-dom
/** @file PageMetadata.test.tsx @description Covers browser titles and sharing tags during navigation. @module navigation */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PageMetadata, usePageTitle } from "./PageMetadata";

/** @returns A fixture that reveals a question title after the route opens. */
function MatchFixture() {
  const [title, setTitle] = useState<string>();
  usePageTitle(title);
  return <button onClick={() => setTitle("Two Sum - Showdown")}>Load question</button>;
}

it("keeps loaded titles out of sharing tags and clears them on navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRootRoute({
    component: () => (
      <PageMetadata>
        <Outlet />
      </PageMetadata>
    ),
  });
  const practice = createRoute({ getParentRoute: () => root, path: "/practice" });
  const match = createRoute({
    getParentRoute: () => root,
    path: "/match/$id",
    component: MatchFixture,
  });
  const router = createRouter({
    routeTree: root.addChildren([practice, match]),
    history: createMemoryHistory({ initialEntries: ["/practice"] }),
  });
  const container = document.createElement("div");
  const app = createRoot(container);
  try {
    await act(async () => {
      app.render(
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>,
      );
    });
    expect(document.title).toBe("Coding Practice - Quorem");

    await act(() => router.navigate({ to: "/match/$id", params: { id: "fixture" } }));
    expect(document.title).toBe("Coding Match - Quorem");
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(document.title).toBe("Two Sum - Showdown");
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "Coding Match - Quorem",
    );

    await act(() => router.navigate({ to: "/practice" }));
    expect(document.title).toBe("Coding Practice - Quorem");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://quorem.app/practice",
    );
  } finally {
    await act(async () => app.unmount());
    document.head.replaceChildren();
    vi.unstubAllGlobals();
  }
});
