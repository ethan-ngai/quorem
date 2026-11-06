import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { caseValidationIssues, type ReportAuthoringValidity } from "./authoringValidation";
import { caseFieldConfig } from "../editor/inputPresets";
import { randomUUID } from "../../randomUUID";
import { Icon } from "../../ui/Icon";
import "../../ui/result-tabs.css";
import { useEffect, useId, useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { TestCases } from "../editor/components/TestCases";
import {
  createCustomDraft,
  formatTypedField,
  parseCustomDraft,
  parseProblemDraft,
  type CustomCaseDraft,
} from "../editor/customCases";
import "../editor/components/customCases.css";
export function AuthoringCases({
  content,
  onChange,
  onValidityChange,
  stageIndex,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: ReportAuthoringValidity;
  stageIndex?: number;
}) {
  const [collection, setCollection] = useState<"public" | "hidden">("public");
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const id = useId();
  const p = content.problem;
  const stage = stageIndex === undefined ? undefined : p.odyssey?.levels[stageIndex];
  const examples = stage?.examples ?? p.examples;
  const hiddenCases =
    stageIndex === undefined
      ? content.hiddenCases
      : (content.odysseyHiddenCases?.[stageIndex] ?? []);
  const caseKey = `cases:${id}`;
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(
    () => () => {
      validity.current(`${caseKey}:public`, false);
      validity.current(`${caseKey}:hidden`, false);
    },
    [caseKey],
  );
  const defaults = createCustomDraft({ ...p, examples: [] });
  function format(
    type: string,
    value: Parameters<typeof formatTypedField>[1],
    fallback: string,
    input?: Parameters<typeof formatTypedField>[2],
  ) {
    try {
      return formatTypedField(type, value, input);
    } catch {
      return fallback;
    }
  }

  const draft = (test: QuestionContent["hiddenCases"][number]): CustomCaseDraft => ({
    id: randomUUID(),
    args: p.sql
      ? [JSON.stringify(test.args[0] ?? { tables: [] })]
      : p.signature.parameters.map((parameter, index) =>
          format(
            parameter.type,
            test.args[index]!,
            defaults.args[index]!,
            caseFieldConfig(p.signature, parameter.type, parameter.input, false, {
              args: test.args,
            }),
          ),
        ),
    expectedEnabled: true,
    expected: p.sql
      ? JSON.stringify(test.expected ?? { rows: [] })
      : format(
          p.signature.returnType,
          test.expected ?? null,
          defaults.expected,
          caseFieldConfig(p.signature, p.signature.returnType, undefined, true, {
            args: test.args,
          }),
        ),
  });
  const [values, setValues] = useState(() => ({
    public: examples.map(draft),
    hidden: hiddenCases.map(draft),
  }));
  useEffect(() => {
    for (const tab of ["public", "hidden"] as const) {
      const label = `${stageIndex === undefined ? "" : `Step ${stageIndex + 1}, `}${tab === "public" ? "Example" : "Private test"}`;
      const issues = caseValidationIssues(values[tab], p, label);
      validity.current(`${caseKey}:${tab}`, issues.length > 0, issues);
    }
  }, [values, p.sql, p.signature, p.constraints, caseKey]);
  const [explanations, setExplanations] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      values.public.map((test, index) => [test.id, examples[index]?.explanation ?? ""]),
    ),
  );
  function change(next: CustomCaseDraft[], descriptions = explanations) {
    setValues((current) => ({ ...current, [collection]: next }));
    try {
      const tests = next.map((test) =>
        p.sql ? parseProblemDraft(test, p) : parseCustomDraft(test, p.signature),
      );
      if (collection === "public") {
        const examples = tests.map((test, index) => ({
          ...test,
          expected: test.expected!,
          explanation: descriptions[next[index]!.id],
        }));
        onChange({
          ...content,
          problem:
            stageIndex === undefined || !p.odyssey
              ? { ...p, examples }
              : {
                  ...p,
                  odyssey: {
                    ...p.odyssey,
                    levels: p.odyssey.levels.map((level, index) =>
                      index === stageIndex ? { ...level, examples } : level,
                    ),
                  },
                },
        });
      } else {
        if (stageIndex === undefined) onChange({ ...content, hiddenCases: tests });
        else
          onChange({
            ...content,
            odysseyHiddenCases: p.odyssey?.levels.map((_, index) =>
              index === stageIndex ? tests : (content.odysseyHiddenCases?.[index] ?? []),
            ),
          });
      }
    } catch {
      // Preserve incomplete local edits; the validation effect reports their exact origin.
    }
  }
  return (
    <div className="authoring-test-collections">
      <AuthoringTabs
        id={id}
        label="Question tests"
        appearance="default"
        value={collection}
        onChange={setCollection}
        panelId={() => `${id}-cases`}
        tabs={(["public", "hidden"] as const).map((tab) => ({
          value: tab,
          icon: <Icon name={tab === "public" ? "samples" : "lock"} />,
          label: `${tab === "public" ? "Examples" : "Private tests"} (${values[tab].length})`,
        }))}
      />
      <div
        className="authoring-case-browser"
        role="tabpanel"
        id={`${id}-cases`}
        aria-labelledby={`${id}-${collection}`}
      >
        <TestCases
          key={collection}
          problem={p.sql ? { ...p, examples: [] } : p}
          customMode
          drafts={values[collection]}
          onDraftsChange={change}
          requiredExpected
          minimumCases={0}
          maximumCases={collection === "hidden" ? 100 : 20}
          customCaseDetails={
            collection === "public"
              ? (index) => {
                  const example = values.public[index];
                  if (!example) return null;
                  return (
                    <label className="typed-case-field admin-example-explanation">
                      <span>
                        <Icon name="samples" /> Example explanation <small>Optional</small>
                      </span>
                      <textarea
                        rows={2}
                        placeholder="Explain why this example produces the expected output."
                        value={explanations[example.id] ?? ""}
                        onChange={(event) => {
                          const next = { ...explanations, [example.id]: event.target.value };
                          setExplanations(next);
                          change(values.public, next);
                        }}
                      />
                    </label>
                  );
                }
              : undefined
          }
          selectedCustomId={selected[collection]}
          onSelectCustomCase={(value) =>
            setSelected((current) => ({ ...current, [collection]: value }))
          }
        />
      </div>
    </div>
  );
}
