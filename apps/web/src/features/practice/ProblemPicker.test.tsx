import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProblemPicker } from "./ProblemPicker";

it("warns about an empty random pool without opening the picker", () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  client.setQueryData(["random-pool", "alice", undefined, {}, "easy"], { items: [], total: 0 });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProblemPicker
        items={[]}
        identity="alice"
        difficulties={["easy"]}
        allowRandom
        onChange={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(html).toContain("No matching questions");
  expect(html).toContain("problem-picker-label-default");
  expect(html).toContain("problem-picker-label-warning");
  expect(html).toContain("No questions match these filters. Choose other filters.");
  expect(html).toContain('data-warning="true"');
  expect(html).not.toContain("random-pool-message");
  expect(html).toContain('role="status"');
  expect(html).toContain("aria-describedby=");
});
