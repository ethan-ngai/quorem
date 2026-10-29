/** @file EditorialPanel.test.tsx @description Spoiler disclosure stays opt-in and absent in matches. @module editor */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EditorialPanel } from "./EditorialPanel";

it("keeps editorial content hidden while enabling preload for published complexity", () => {
  const client = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EditorialPanel identity="alice" versionId="version" />
    </QueryClientProvider>,
  );
  expect(markup).toContain("Complexity");
  expect(markup).not.toContain("solutions");
  expect(markup).not.toContain("editorial-source");
  expect(markup).not.toContain("Auxiliary space");
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey[0]),
  ).toEqual(["complexity", "solutions"]);
});

it("omits spoilers in match workspaces", () => {
  const client = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EditorialPanel identity="alice" versionId="version" inMatch solutionAvailable />
    </QueryClientProvider>,
  );
  expect(markup).toBe("");
});

it("omits the disclosure and fetch when no published complexity exists", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EditorialPanel identity="alice" versionId="missing-complexity" available={false} />
    </QueryClientProvider>,
  );
  expect(html).toBe("");
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.state.fetchStatus === "idle"),
  ).toBe(true);
});

it("offers a source-only solution without inventing complexity", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EditorialPanel
        identity="alice"
        versionId="source-only"
        available={false}
        solutionAvailable
      />
    </QueryClientProvider>,
  );
  expect(html).toContain("Solution");
  expect(html).not.toContain("Complexity");
  expect(html).not.toContain("editorial-source");
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.state.fetchStatus === "idle"),
  ).toBe(true);
});
