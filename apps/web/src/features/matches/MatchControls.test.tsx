// @vitest-environment happy-dom
import { matchPreset } from "@quorem/contracts/match-rules";
import type { PartySettings } from "@quorem/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultMatchSettings, MatchSettings } from "./MatchControls";

vi.mock("../../api/client", () => ({
  api: () => ({
    GET: async () => ({ data: { items: [], topics: [], companies: [], total: 1 } }),
  }),
  requireData: (data: unknown) => data,
}));

describe("server-rendered match settings", () => {
  it("shows selected catalog, duration and conduct choices before hydration", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MatchSettings
          identity="alice"
          disabled
          catalog={[{ id: "example", title: "Two Sum", difficulty: "easy" }]}
          value={{
            mode: "free-for-all",
            difficulties: ["easy"],
            selectedProblemVersionId: "example",
            durationMinutes: 30,
            shareCodeAfterMatch: true,
            rules: { ...matchPreset("casual"), clipboard: "warning", focus: "announce" },
          }}
          onChange={() => {}}
        />
      </QueryClientProvider>,
    );
    for (const label of ["Two Sum", "30 min", "Paste: Block", "Leave window: Notify"])
      expect(html).toContain(label);
    expect(html.match(/aria-label="Leave window: [^"]+"/g)).toEqual([
      'aria-label="Leave window: Allow"',
      'aria-label="Leave window: Notify"',
      'aria-label="Leave window: Penalize"',
    ]);
    expect(html.match(/aria-label="Difficulty filter"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Question filters"');
    expect(html).toContain('aria-label="SQL questions"');
    expect(html).toContain('aria-label="Topics"');
    expect(html).not.toContain("Problem list unavailable");
    expect(html).not.toContain("Guest access");
    expect(html).not.toContain("Allow guests");
    expect(html).not.toContain("Lobby admission");
  });
});

it("keeps an eligible lobby question and resets an excluded question to Random", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const catalog = [{ id: "example", title: "Two Sum", difficulty: "easy" }];
  function Lobby() {
    const [settings, setSettings] = useState<PartySettings>({
      ...defaultMatchSettings,
      selectedProblemVersionId: "example",
    });
    return (
      <MatchSettings
        identity="alice"
        catalog={catalog}
        value={settings}
        onChange={(next) => {
          onChange(next);
          setSettings(next);
        }}
      />
    );
  }
  const click = (label: string) =>
    act(async () =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
    );
  const picker = () => container.querySelector('button[aria-label="Problem"]')?.textContent;
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Lobby />
        </QueryClientProvider>,
      ),
    );
    await click("Question filters");
    await click("Classic");
    expect(picker()).toBe("Two Sum");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedProblemVersionId: "example" }),
    );
    await click("Odyssey");
    expect(picker()).toContain("Random");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        questionFilters: { type: "odyssey" },
        selectedProblemVersionId: undefined,
      }),
    );
    await click("All question types");
    expect(picker()).toContain("Random");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
