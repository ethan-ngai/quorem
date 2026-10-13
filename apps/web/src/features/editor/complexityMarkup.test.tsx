import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { complexityMath, complexityNotesMarkup } from "./complexityMarkup";
import { ComplexityDetails } from "./components/EditorialPanel";

describe("complexity mathematics", () => {
  it("renders costs and defined variables with KaTeX", () => {
    const markup = renderToStaticMarkup(
      <ComplexityDetails
        value={{
          language: "python",
          timeComplexity: "O(n)",
          spaceComplexity: "O(w)",
          complexityNotes: "n is the number of nodes; w is the maximum occupied level width.",
        }}
      />,
    );
    expect((markup.match(/class="katex"/g) ?? []).length).toBe(4);
    expect(markup).toContain('encoding="application/x-tex">O(n)');
    expect(markup).toContain('encoding="application/x-tex">w');
    expect(markup).not.toContain("<code>");
  });
  it("formats logarithms and Big-O references without changing ordinary prose", () => {
    expect(complexityMath("O(n log(S + 1))")).toBe("$O(n \\log(S + 1))$");
    expect(
      complexityNotesMarkup(
        "n is the input length; S is their sum. Auxiliary space excludes the O(n) result.",
        "O(n log(S + 1))",
        "O(1)",
      ),
    ).toBe(
      "$n$ is the input length; $S$ is their sum. Auxiliary space excludes the $O(n)$ result.",
    );
  });
  it("preserves authored math and unrelated code while converting quoted free variables", () => {
    expect(complexityNotesMarkup("$n$ nodes in `root`; `w` is the width.", "O(n)", "O(w)")).toBe(
      "$n$ nodes in `root`; $w$ is the width.",
    );
    expect(complexityMath("$O(n^2 \\log n)$")).toBe("$O(n^{2} \\log n)$");
  });
});
