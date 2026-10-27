import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteError } from "./RouteError";

describe("route error recovery", () => {
  it("offers recovery without exposing exception details", () => {
    const html = renderToStaticMarkup(<RouteError reset={() => {}} />);
    expect(html).toContain("Try again");
    expect(html).toContain('href="/practice"');
    expect(html).not.toContain("Wrong argument count");
  });
});
