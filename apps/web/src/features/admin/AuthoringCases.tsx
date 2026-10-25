import { useId, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { TestCases } from "../editor/components/TestCases";
import {
  createCustomDraft,
  formatTypedField,
  parseCustomDraft,
  type CustomCaseDraft,
} from "../editor/customCases";
import "../editor/components/customCases.css";
export function AuthoringCases({
  content,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const [collection, setCollection] = useState<"public" | "hidden">("public");
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const id = useId();
  const p = content.problem;
  const draft = (test: QuestionContent["hiddenCases"][number]): CustomCaseDraft => ({
    id: crypto.randomUUID(),
    args: p.signature.parameters.map((parameter, index) =>
      formatTypedField(parameter.type, test.args[index]!, parameter.input),
    ),
    expectedEnabled: true,
    expected: formatTypedField(p.signature.returnType, test.expected ?? null),
  });
  const [values, setValues] = useState(() => ({
    public: p.examples.map(draft),
    hidden: content.hiddenCases.map(draft),
  }));
  function change(next: CustomCaseDraft[]) {
    setValues((current) => ({ ...current, [collection]: next }));
    try {
      const tests = next.map((test) => parseCustomDraft(test, p.signature, p.constraints));
      onValidityChange(`cases:${collection}`, false);
      if (collection === "public")
        onChange({
          ...content,
          problem: {
            ...p,
            examples: tests.map((test, index) => ({
              ...test,
              expected: test.expected!,
              explanation: p.examples[index]?.explanation,
            })),
          },
        });
      else
        onChange({
          ...content,
          hiddenCases: tests.map((test) => ({ ...test, expected: test.expected! })),
        });
    } catch {
      onValidityChange(`cases:${collection}`, true);
    }
  }
  return (
    <div className="authoring-test-collections">
      <div className="result-tabs" role="tablist" aria-label="Question tests">
        {(["public", "hidden"] as const).map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab}
            id={`${id}-${tab}`}
            aria-selected={collection === tab}
            aria-controls={`${id}-cases`}
            onClick={() => setCollection(tab)}
          >
            {tab === "public" ? "Examples" : "Private tests"} ({values[tab].length})
          </button>
        ))}
      </div>
      <div
        className="authoring-case-browser"
        role="tabpanel"
        id={`${id}-cases`}
        aria-labelledby={`${id}-${collection}`}
      >
        <TestCases
          key={collection}
          problem={p}
          customMode
          drafts={values[collection]}
          onDraftsChange={change}
          requiredExpected
          minimumCases={0}
          selectedCustomId={selected[collection]}
          onSelectCustomCase={(value) =>
            setSelected((current) => ({ ...current, [collection]: value }))
          }
        />
      </div>
      {collection === "hidden" && values.hidden.length < 20 && (
        <button
          type="button"
          className="quiet-button"
          onClick={() =>
            change([
              ...values.hidden,
              ...Array.from({ length: 20 - values.hidden.length }, () => ({
                ...createCustomDraft(p),
                expectedEnabled: true,
              })),
            ])
          }
        >
          Fill to 20 private tests
        </button>
      )}
      {collection === "public" &&
        p.examples.map((example, index) => (
          <label className="admin-field" key={index}>
            <span>Example {index + 1} explanation</span>
            <textarea
              rows={2}
              value={example.explanation ?? ""}
              onChange={(event) =>
                onChange({
                  ...content,
                  problem: {
                    ...p,
                    examples: p.examples.map((test, i) =>
                      i === index ? { ...test, explanation: event.target.value } : test,
                    ),
                  },
                })
              }
            />
          </label>
        ))}
    </div>
  );
}
