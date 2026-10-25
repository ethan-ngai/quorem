import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MethodCall, Signature } from "@quorem/contracts";
import { CaseOutput } from "./CaseOutput";
import { ProblemStatement } from "./ProblemStatement";
import { SequenceCaseValues } from "./SequenceCaseValues";
import { blankQuestion } from "../../admin/content";
const signature = (methodName: string, returnType: string): Signature => ({
  className: "Solution",
  methodName,
  parameters: [],
  returnType,
});
const methods = [
  signature("save", "void"),
  signature("get", "optional<str>"),
  signature("count", "int"),
  signature("top_k", "list<str>"),
];
const calls: MethodCall[] = [
  { methodName: "save", args: [], expected: null },
  { methodName: "get", args: [], expected: null },
  { methodName: "count", args: [], expected: 2 },
  { methodName: "top_k", args: [], expected: ["a", "b"] },
];
const problem = {
  ...blankQuestion().problem,
  title: "Memory",
  odyssey: {
    levels: [{ title: "Store", statementMarkdown: "Store memories.", methods, examples: [] }],
  },
  examples: [{ args: [], calls }],
};
it("omits void output but retains an optional None and a list-valued return", () => {
  const html = renderToStaticMarkup(
    <CaseOutput
      sequence={{ methods, calls }}
      showExpected={false}
      result={{ index: 0, status: "accepted", actual: [123, null, 2, ["a", "b"]] }}
    />,
  );
  expect(html).not.toContain("save output");
  expect(html).not.toContain(">123<");
  expect(html).toContain('aria-label="Call 2: get"');
  expect(html).toContain(">None<");
  expect(html).toContain('aria-label="Call 3: count"');
  expect(html).toContain('aria-label="Call 4: top_k"');
  expect(html).toContain("[&quot;a&quot;,&quot;b&quot;]");
});
it("groups statement examples by numbered calls and omits void outputs", () => {
  const html = renderToStaticMarkup(<ProblemStatement problem={problem} />);
  expect(html).not.toContain("Output from save");
  expect(html).toContain('aria-label="Call 2: get"');
  expect(html).toContain('aria-label="Call 3: count"');
  expect(html).toContain('aria-label="Call 4: top_k"');
  expect(html.match(/>Output<\/span>/g)).toHaveLength(3);
  expect(html).toContain("No arguments");
  expect(html).not.toContain("[None,None,2,");
  const details = renderToStaticMarkup(<SequenceCaseValues problem={problem} calls={calls} />);
  expect(details.match(/>Expected output<\/span>/g)).toHaveLength(3);
});

it("groups inputs with paired actual and expected values, including void call inputs", () => {
  const html = renderToStaticMarkup(
    <CaseOutput
      sequence={{
        methods: [
          { ...signature("save", "void"), parameters: [{ name: "text", type: "str" }] },
          signature("count", "int"),
        ],
        calls: [
          { methodName: "save", args: ["Remember this"] },
          { methodName: "count", args: [], expected: 1 },
        ],
      }}
      result={{ index: 0, status: "wrong_answer", actual: [null, 0], expected: [null, 1] }}
    />,
  );
  expect(html).toContain("Remember this");
  expect(html).toContain('class="case-output-comparison"');
  expect(html).toContain(">Output</span>");
  expect(html).toContain(">Expected</span>");
  expect(html).toContain('verdict-error">0</code>');
  expect(html).toContain('verdict-success">1</code>');
  expect(html.match(/class="case-output-comparison"/g)).toHaveLength(1);
});
