/** @file EditorialPanel.test.tsx @description Spoiler disclosure stays opt-in and absent in matches. @module editor */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EditorialPanel } from "./EditorialPanel";

it("does not render or fetch editorial code and costs on initial opening", () => {
  const client = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EditorialPanel identity="alice" versionId="version" />
    </QueryClientProvider>,
  );
  expect(markup).toContain("Show complexity");
  expect(markup).not.toContain("solutions");
  expect(markup).toContain("visibility-icon");
  expect(markup).not.toContain("editorial-source");
  expect(markup).not.toContain("Auxiliary space");
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey[0]),
  ).toEqual(["complexity"]);
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.state.fetchStatus === "idle"),
  ).toBe(true);
});

it("omits spoilers in match workspaces", () => {
  const client = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EditorialPanel identity="alice" versionId="version" inMatch />
    </QueryClientProvider>,
  );
  expect(markup).toBe("");
});
