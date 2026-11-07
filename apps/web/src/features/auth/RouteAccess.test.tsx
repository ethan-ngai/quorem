// @vitest-environment happy-dom
/** @file RouteAccess.test.tsx @description Protects sign-in navigation during pending route loads. @module auth */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SignInRedirect } from "./RouteAccess";

it("preserves the protected destination while the login route loads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const destination = "/interview/example?view=editor#code";
  let finishLoginLoad!: () => void;
  const loginReady = new Promise<void>((resolve) => {
    finishLoginLoad = resolve;
  });
  const root = createRootRoute();
  const interview = createRoute({
    getParentRoute: () => root,
    path: "/interview/$id",
    component: SignInRedirect,
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    loader: () => loginReady,
  });
  const router = createRouter({
    routeTree: root.addChildren([interview, login]),
    history: createMemoryHistory({ initialEntries: [destination] }),
  });
  const app = createRoot(document.createElement("div"));
  try {
    await act(async () => app.render(<RouterProvider router={router} />));
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ returnTo: destination });

    await act(async () => finishLoginLoad());
    expect(router.state.location.search).toEqual({ returnTo: destination });
    expect(router.history.length).toBe(1);
  } finally {
    finishLoginLoad();
    await act(async () => app.unmount());
    vi.unstubAllGlobals();
  }
});
