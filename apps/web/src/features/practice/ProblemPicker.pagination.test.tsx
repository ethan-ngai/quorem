// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ProblemPicker } from "./ProblemPicker";

const get = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({
  api: () => ({ GET: get }),
  requireData: (data: unknown, error: unknown) => {
    if (error) throw error;
    return data;
  },
}));

it("appends pages, retains results after a page failure, retries and resets for search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let failNext = true;
  get.mockImplementation(
    async (_: string, options?: { params?: { query?: { page?: number; q?: string } } }) => {
      const { page = 1, q } = options?.params?.query ?? {};
      if (page === 2 && failNext) {
        failNext = false;
        throw new Error("Unavailable");
      }
      const total = q ? 1 : 31;
      return {
        data: {
          items: Array.from({ length: q ? 1 : page === 1 ? 30 : 1 }, (_, i) => ({
            id: q ? "search" : String((page - 1) * 30 + i),
            title: q ? "Searched question" : `Question ${(page - 1) * 30 + i}`,
            difficulty: "easy",
          })),
          total,
          topics: [],
          companies: [],
        },
      };
    },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const chosen = vi.fn();
  const click = async (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (button) =>
          button.textContent?.trim() === label || button.getAttribute("aria-label") === label,
      );
      expect(button).toBeTruthy();
      button!.click();
    });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProblemPicker items={[]} onChange={chosen} />
      </QueryClientProvider>,
    ),
  );
  await click("Problem");
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Question 29"));
  });
  await click("Load more questions");
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Could not load more"));
  });
  expect(document.body.textContent).toContain("Question 0");
  await click("Retry");
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Question 30"));
  });
  expect(document.body.textContent).not.toContain("Load more questions");
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search problems"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "search",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Searched question"));
  });
  expect(document.body.textContent).not.toContain("Question 29");
  await click("Searched questioneasy");
  expect(chosen).toHaveBeenCalledWith("search", expect.objectContaining({ id: "search" }));
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
