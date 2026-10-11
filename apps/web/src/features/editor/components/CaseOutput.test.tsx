import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseOutput } from "./CaseOutput";

describe("case output", () => {
  it("omits repeated expectations and combines colored streams in one console box", () => {
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
    expect(markup).toContain('class="console-stream" aria-label="stdout"');
    expect(markup).toContain('class="console-stream console-error" aria-label="stderr"');
    expect(markup.match(/<pre>/g)).toHaveLength(1);
    expect(markup).toContain('class="field-purpose" title="Standard output"');
    expect(markup).not.toContain("typed-case-error");
  });
  it("hides absent, empty and whitespace-only console streams", () => {
    for (const stdout of [undefined, "", " \n\t"]) {
      const markup = renderToStaticMarkup(
        <CaseOutput result={{ index: 0, status: "executed", stdout }} />,
      );
      expect(markup).not.toContain("Standard output");
    }
  });
  it("leaves uncompared output neutral", () => {
    const markup = renderToStaticMarkup(
      <CaseOutput result={{ index: 0, status: "executed", actual: 90 }} />,
    );
    expect(markup).toContain("machine-value verdict-neutral");
  });
});
