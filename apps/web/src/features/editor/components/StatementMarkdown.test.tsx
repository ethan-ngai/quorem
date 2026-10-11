import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatementMarkdown } from "./StatementMarkdown";

const render = (source: string) => renderToStaticMarkup(<StatementMarkdown source={source} />);

describe("restricted statement Markdown", () => {
  it("supports nested emphasis, escaped delimiters and multi-backtick code", () => {
    const markup = render("**strong *nested*** and \\*literal\\* with ``a`b``.");
    expect(markup).toContain("<strong>strong <em>nested</em></strong>");
    expect(markup).toContain("*literal*");
    expect(markup).toContain("<code>a`b</code>");
  });
  it("renders deliberate math, without interpreting math inside code", () => {
    const markup = render("`$x^2$` and $x^2 \\le 10^{4}$");
    expect(markup).toContain("<code>$x^2$</code>");
    expect(markup).toContain('class="katex"');
    expect(markup).toContain("<msup>");
    expect(markup).toContain("<mo>≤</mo>");
  });
  it("leaves unclosed and invalid math readable", () => {
    expect(render("Unclosed $x and **word")).toContain("Unclosed $x and **word");
    expect(render("Invalid $\\notacommand{x}$")).toContain("$\\notacommand{x}$");
    expect(render("Escaped \\$x\\$")).not.toContain('class="katex"');
  });
  it("keeps HTML, links, images and block syntax inert", () => {
    const markup = render(
      "<img src=x onerror=alert(1)>\n\n[link](https://example.com) ![image](x)\n\n# Heading\n\n- Item\n\n```python\nreturn 1\n```",
    );
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("[link](https://example.com)");
    expect(markup).toContain("![image](x)");
    expect(markup).toContain("# Heading");
    expect(markup).toContain("```python");
    expect(markup).not.toMatch(/<(img|a|h2|ul|pre)\b/);
  });
  it("isolates macros and forbids trusted HTML and remote resources", () => {
    const markup = render(
      "$\\gdef\\owned{1}\\owned$ $\\owned$ $\\href{https://example.com}{click}$ $\\includegraphics{https://example.com/x}$ $\\htmlStyle{color:red}{x}$",
    );
    expect(markup).toContain("$\\owned$");
    expect(markup).not.toMatch(/<(a|img)\b|href=/);
    expect(markup).not.toContain('style="color:red');
  });
  it("falls back for expansion loops and oversized math source", () => {
    expect(render("$\\def\\a{\\a}\\a$")).toContain("$\\def\\a{\\a}\\a$");
    expect(render(`$${"x".repeat(4097)}$`)).not.toContain('class="katex"');
  });
});
