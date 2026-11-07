import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseOutput, CaseVerdict } from "./CaseOutput";

describe("case output", () => {
  it("keeps array punctuation separate from verdict and value colors", () => {
    const markup = renderToStaticMarkup(
      <CaseOutput result={{ index: 0, status: "accepted", actual: [0, 9], expected: [0, 9] }} />,
    );
    expect(markup).toContain('<span class="code-punctuation">[</span>');
    expect(markup).toContain('<span class="code-punctuation">]</span>');
    expect(markup).toContain('<span class="code-number">9</span>');
  });
  it("puts stderr directly under the verdict and keeps stdout with the values", () => {
    const markup = renderToStaticMarkup(
      <CaseOutput
        showExpected={false}
        result={{
          index: 0,
          status: "wrong_answer",
          actual: 90,
          expected: 18,
          stdout: "hello\n",
          stderr: "notice\n",
        }}
      />,
    );
    expect(markup).not.toContain("Expected output");
    expect(markup).toContain("machine-value verdict-error");
    expect(markup).toContain('aria-label="Standard output"');
    expect(markup).toContain('<span aria-label="stdout">hello');
    expect(markup).toContain('<code class="case-error-message"><span aria-label="stderr">notice');
    expect(markup.indexOf('aria-label="stderr"')).toBeLessThan(markup.indexOf(">Output<"));
    expect(markup.match(/aria-label="stderr"/g)).toHaveLength(1);
    expect(markup.match(/<pre>/g)).toHaveLength(1);
    expect(markup).toContain('class="field-purpose" aria-label="Standard output"');
    expect(markup).not.toContain("typed-case-error");
  });
  it("hides absent, empty and whitespace-only console streams", () => {
    for (const stdout of [undefined, "", " \n\t"]) {
      const markup = renderToStaticMarkup(
        <CaseOutput result={{ index: 0, status: "executed", stdout, stderr: stdout }} />,
      );
      expect(markup).not.toContain("Standard output");
      expect(markup).not.toContain("case-error-message");
    }
  });
  it("leaves uncompared output neutral", () => {
    const markup = renderToStaticMarkup(
      <CaseOutput result={{ index: 0, status: "executed", actual: 90 }} />,
    );
    expect(markup).toContain("machine-value verdict-neutral");
  });
});

it("shows the SQL error and line next to the result", () => {
  const markup = renderToStaticMarkup(
    <CaseOutput
      result={{
        index: 0,
        status: "runtime_error",
        diagnostics: [{ line: 2, message: 'column "missing" does not exist' }],
      }}
    />,
  );
  expect(markup).not.toContain('aria-label="Diagnostics"');
  expect(markup).toContain('class="case-error-message"');
  expect(markup).toContain('class="case-verdict verdict-error"');
  expect(markup).toContain("Line 2:");
  expect(markup).toContain("column &quot;missing&quot; does not exist");
});

it("renders no status container for a case without a result", () => {
  expect(renderToStaticMarkup(<CaseVerdict />)).toBe("");
});
