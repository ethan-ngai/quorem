import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchSettings } from "./MatchControls";

describe("server-rendered match settings", () => {
  it("shows selected catalog, duration and conduct choices before hydration", () => {
    const html = renderToStaticMarkup(
      <MatchSettings
        identity="alice"
        disabled
        showHostRules
        catalog={[{ id: "example", title: "Two Sum", difficulty: "easy" }]}
        value={{
          mode: "free-for-all",
          difficulties: ["easy"],
          selectedProblemVersionId: "example",
          durationMinutes: 30,
          rules: { clipboard: "warning", focus: "announce" },
        }}
        onChange={() => {}}
      />,
    );
    for (const label of ["Two Sum", "30 minutes", "Warn", "Announce to lobby"])
      expect(html).toContain(label);
    expect(html).not.toContain("Problem list unavailable");
  });
});
