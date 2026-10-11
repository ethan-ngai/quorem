/** @file StatementMarkdown.test.tsx @description Safe readable statement rendering. @module editor */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatementMarkdown } from "./StatementMarkdown";

describe("statement rendering", () => {
  it("renders inline code and fences without exposing markdown delimiters", () => {
    const markup = renderToStaticMarkup(
      <StatementMarkdown source={"Return `run_widths(text)`.\n\n```python\nreturn [1, 2]\n```"} />,
    );
    expect(markup).toContain("<code>run_widths(text)</code>");
    expect(markup).toContain("<pre><code>return [1, 2]</code></pre>");
    expect(markup).not.toContain("`");
  });
  it("keeps raw HTML inert", () => {
    const markup = renderToStaticMarkup(
      <StatementMarkdown source={"<img src=x onerror=alert(1)>"} />,
    );
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
  });
});
