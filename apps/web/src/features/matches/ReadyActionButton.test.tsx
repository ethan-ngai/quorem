import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReadyActionButton } from "./ReadyActionButton";

it("shows immediate pending feedback without claiming readiness", () => {
  const html = renderToStaticMarkup(
    <ReadyActionButton ready={false} pending disabled={false} onClick={() => {}} />,
  );
  expect(html).toContain('aria-label="Getting ready"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-ready="false"');
  expect(html).not.toContain("Saving…");
  expect(html).toContain("readiness-spinner");
});
