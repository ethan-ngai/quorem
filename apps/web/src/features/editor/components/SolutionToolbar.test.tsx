import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SolutionToolbar } from "./SolutionToolbar";

it("shows the SQL dialect with its logo", () => {
  const html = renderToStaticMarkup(
    <SolutionToolbar
      language="postgresql"
      languages={[{ language: "postgresql" }]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('aria-label="SQL dialect"');
  expect(html).toContain("PostgreSQL");
  expect(html).toContain("postgresql.svg");
  expect(html).not.toContain(">SQL</span>");
});
