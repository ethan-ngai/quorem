import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeEditorialFields } from "./CodeEditorialFields";
import { blankQuestion } from "./content";

vi.mock("../editor/useTheme", () => ({ useTheme: () => ({ theme: "dark" }) }));

it("offers missing languages as content without an editorial or enablement toggle", () => {
  const markup = renderToStaticMarkup(
    <CodeEditorialFields
      content={blankQuestion()}
      language="java"
      onLanguageChange={() => {}}
      disabled={false}
      onChange={() => {}}
    />,
  );
  expect(markup).toContain("Add Java");
  expect(markup).toContain('role="combobox"');
  expect(markup).not.toContain('role="switch"');
  expect(markup).not.toContain("Add editorial");
  expect(markup).not.toContain('aria-label="Remove Java"');
});

it("keeps the required Python implementation and offers an optional editorial", () => {
  const markup = renderToStaticMarkup(
    <CodeEditorialFields
      content={blankQuestion()}
      language="python"
      onLanguageChange={() => {}}
      disabled={false}
      onChange={() => {}}
    />,
  );
  expect(markup).toContain("Add editorial");
  expect(markup).not.toContain('aria-label="Remove Python"');
  expect(markup).not.toContain("Publish editorial");
  expect(markup).not.toContain("Private implementation used to verify test results.");
});
