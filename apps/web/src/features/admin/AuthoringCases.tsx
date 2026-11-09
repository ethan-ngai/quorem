import {
  GRAPH_RETURN,
  graphReturnSlot,
  inferCaseGraph,
  mergeGraphOutput,
  primarySignature,
  projectCaseGraphs,
  type CaseGraphs,
  type QuestionGraph,
} from "@quorem/questions";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { caseValidationIssues, type ReportAuthoringValidity } from "./authoringValidation";
import { caseFieldConfig } from "../editor/inputPresets";
import { randomUUID } from "../../randomUUID";
import { Icon } from "../../ui/Icon";
import "../../ui/result-tabs.css";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { TestCases } from "../editor/components/TestCases";
import {
  formatTypedField,
  parseCustomDraft,
  parseTypedField,
  parseProblemDraft,
  type CustomCaseDraft,
} from "../editor/customCases";
import "../editor/components/customCases.css";
import { GraphCaseField } from "./GraphCaseField";
import { graphFromForm, graphToForm, type GraphForm } from "./graphForm";
import type { WireValue } from "../editor/typedValues";
type AuthoringDraft = CustomCaseDraft & {
  unformatted?: string[];
  graphs?: CaseGraphs;
  graphForms?: Record<string, GraphForm>;
  graphError?: string;
};

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
  const sig = !p.sql && !p.odyssey ? primarySignature(p) : undefined;
  const encodings = sig?.graphEncodings ?? {};
  const graphTargets = Object.keys(encodings);
  const graphLabel = (target: string) =>
    target === GRAPH_RETURN
      ? "Expected graph"
      : graphReturnSlot(target) !== undefined
        ? `Expected graph [${graphReturnSlot(target)}]`
        : target;
  function infer(
    args: readonly (WireValue | undefined)[],
    expected?: WireValue,
    explicit?: CaseGraphs,
    skip?: Record<string, GraphForm>,
  ) {
    if (!sig) return;
    const entries = graphTargets.flatMap((target) => {
      if (Object.hasOwn(skip ?? {}, target)) return [];
      const graph =
        explicit?.[target] ??
        inferCaseGraph(sig, target, args, expected, p.limits.maxCollectionElements);
      return graph ? ([[target, graphToForm(graph, encodings[target]!)]] as const) : [];
    });
    if (entries.length) return Object.fromEntries(entries);
  }

  function compile(test: AuthoringDraft, preserveOutput = false): AuthoringDraft {
    if (!sig || !test.graphForms) return test;
    try {
      const graphs = Object.fromEntries(
        Object.entries(test.graphForms).map(([target, form]) => [
          target,
          graphFromForm(form, encodings[target]!, p.limits.maxCollectionElements),
        ]),
      ) as CaseGraphs;
      const generated = projectCaseGraphs(sig, graphs, p.limits.maxCollectionElements);
      const args = sig.parameters.map(({ type, input }, index) =>
        generated.args.has(index)
          ? formatTypedField(
              type,
              generated.args.get(index)!,
              caseFieldConfig(sig, type, input, false),
            )
          : (test.args[index] ?? ""),
      );
      let expected: WireValue | undefined;
      if (generated.outputSlots.size) {
        try {
          expected = parseTypedField(sig.returnType, test.expected);
        } catch {
          // Keep incomplete concrete output editable, while the graph fields remain available.
        }
      }
      const output = mergeGraphOutput<WireValue>(generated, expected, (_, value) => value);
      return {
        ...test,
        args,
        expected:
          output === undefined ||
          (preserveOutput && generated.outputSlots.size && expected === undefined)
            ? test.expected
            : formatTypedField(sig.returnType, output),
        graphs: Object.keys(graphs).length ? graphs : undefined,
        graphError: undefined,
        unformatted: test.unformatted?.filter((field) =>
          field === "expected"
            ? generated.expected === undefined
            : !generated.args.has(Number(field.slice(4))),
        ),
      };
    } catch (error) {
      return {
        ...test,
        graphError: error instanceof Error ? error.message : String(error),
      };
    }
  }
  function graphIssue(test: AuthoringDraft) {
    return (
      test.graphError ??
      graphTargets
        .filter(
          (target) =>
            encodings[target]?.kind === "custom" && !Object.hasOwn(test.graphs ?? {}, target),
        )
        .map((target) => `${graphLabel(target)} is required for a custom encoding.`)
        .join(" ")
    );
  }
  const stage = stageIndex === undefined ? undefined : p.odyssey?.levels[stageIndex];
  const examples = stage?.examples ?? p.examples;
  const hiddenCases = stageIndex === undefined ? content.hiddenCases : (stage?.hiddenCases ?? []);
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
  function format(
    type: string,
    value: Parameters<typeof formatTypedField>[1],
    field: string,
    unformatted: string[],
    input?: Parameters<typeof formatTypedField>[2],
  ) {
    try {
      const source = formatTypedField(type, value, input);
      if (JSON.stringify(parseTypedField(type, source, input)) !== JSON.stringify(value))
        throw new Error("Incompatible case value");
      return source;
    } catch {
      unformatted.push(field);
      return JSON.stringify(value) ?? "undefined";
    }
  }

  const draft = (test: QuestionContent["hiddenCases"][number]): AuthoringDraft => {
    const unformatted: string[] = [];
    const result: AuthoringDraft = {
      id: randomUUID(),
      graphForms: infer(test.args, test.expected, test.graphs),
      graphs: test.graphs,
      args: p.sql
        ? [JSON.stringify(test.args[0] ?? { tables: [] })]
        : primarySignature(p).parameters.map((parameter, index) =>
            format(
              parameter.type,
              test.args[index]!,
              `arg:${index}`,
              unformatted,
              caseFieldConfig(primarySignature(p), parameter.type, parameter.input, false, {
                args: test.args,
              }),
            ),
          ),
      expectedEnabled: true,
      expected: p.sql
        ? JSON.stringify(test.expected ?? { rows: [] })
        : format(
            primarySignature(p).returnType,
            test.expected ?? null,
            "expected",
            unformatted,
            caseFieldConfig(primarySignature(p), primarySignature(p).returnType, undefined, true, {
              args: test.args,
            }),
          ),
    };
    if (unformatted.length) result.unformatted = unformatted;
    return compile(result);
  };
  const [values, setValues] = useState(() => ({
    public: examples.map(draft),
    hidden: hiddenCases.map(draft),
  }));
  useEffect(() => {
    for (const tab of ["public", "hidden"] as const) {
      const label = `${stageIndex === undefined ? "" : `Step ${stageIndex + 1}, `}${tab === "public" ? "Example" : "Private test"}`;
      const issues = [
        ...caseValidationIssues(values[tab], p, label),
        ...values[tab].flatMap((test, index) => {
          const error = graphIssue(test);
          return error ? [{ message: `${label} ${index + 1}: ${error}` }] : [];
        }),
        ...values[tab].flatMap((test, index) =>
          (test.unformatted ?? []).map((field) => ({
            message: `${label} ${index + 1}: replace the incompatible ${field === "expected" ? "expected output" : `input ${Number(field.slice(4)) + 1}`}.`,
          })),
        ),
      ];
      validity.current(`${caseKey}:${tab}`, issues.length > 0, issues);
    }
  }, [values, p.sql, p.signature, p.odyssey, p.constraints, caseKey]);
  const [explanations, setExplanations] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      values.public.map((test, index) => [test.id, examples[index]?.explanation ?? ""]),
    ),
  );
  function change(next: CustomCaseDraft[], descriptions = explanations) {
    const previous = new Map(values[collection].map((item) => [item.id, item]));
    const updated: AuthoringDraft[] = (next as AuthoringDraft[]).map((item) => {
      const before = previous.get(item.id);
      const unformatted = before?.unformatted?.filter((field) =>
        field === "expected"
          ? item.expected === before.expected
          : item.args[Number(field.slice(4))] === before.args[Number(field.slice(4))],
      );
      let graphForms = item.graphForms;
      if (sig && graphTargets.some((target) => !Object.hasOwn(graphForms ?? {}, target))) {
        const read = (
          type: string,
          source: string,
          config?: Parameters<typeof parseTypedField>[2],
        ) => {
          try {
            return parseTypedField(type, source, config);
          } catch {
            return undefined;
          }
        };
        const args = sig.parameters.map(({ type, input }, i) =>
          read(
            type,
            item.args[i] ?? "",
            caseFieldConfig(sig, type, input, false, { sources: item.args }),
          ),
        );
        const inferred = infer(args, read(sig.returnType, item.expected), undefined, graphForms);
        if (inferred) graphForms = { ...inferred, ...graphForms };
      }
      return compile(
        { ...item, graphForms, unformatted },
        !!before && item.expected !== before.expected,
      );
    });
    setValues((current) => ({ ...current, [collection]: updated }));
    try {
      if (updated.some((item) => item.unformatted?.length || item.graphError)) return;
      const tests = updated.map((test) => ({
        ...(p.sql ? parseProblemDraft(test, p) : parseCustomDraft(test, primarySignature(p))),
        ...(test.graphs ? { graphs: test.graphs } : {}),
      }));
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
            problem: {
              ...p,
              odyssey: p.odyssey && {
                levels: p.odyssey.levels.map((level, index) =>
                  index === stageIndex ? { ...level, hiddenCases: tests } : level,
                ),
              },
            },
          });
      }
    } catch {
      // Preserve incomplete local edits; the validation effect reports their exact origin.
    }
  }
  function renderGraphField(index: number, name: string, native: ReactNode): ReactNode {
    const test = values[collection][index];
    if (!sig || !test) return native;
    if (
      graphTargets.some(
        (target) => test.graphForms?.[target] && encodings[target]?.countParameter === name,
      )
    )
      return null;
    const targets =
      name === GRAPH_RETURN
        ? graphTargets.filter((target) => target === name || graphReturnSlot(target) !== undefined)
        : graphTargets.filter((target) => target === name);
    if (!targets.length) return native;
    const applyForm = (target: string, form: GraphForm) =>
      change(
        values[collection].map((item) =>
          item.id === test.id
            ? { ...item, graphForms: { ...item.graphForms, [target]: form } }
            : item,
        ),
      );
    const sections = targets.map((target, targetIndex) => {
      const encoding = encodings[target]!;
      const form = test.graphForms?.[target];
      if (!form && encoding.kind !== "custom") return null;
      const arg = sig.parameters.findIndex(({ name }) => name === target);
      const count = sig.parameters.findIndex(({ name }) => name === encoding.countParameter);
      const graph: QuestionGraph = { directed: false, nodes: [], edges: [] };
      const slot = graphReturnSlot(target);
      let source = target === GRAPH_RETURN ? test.expected : undefined;
      if (arg >= 0)
        source = `${target} = ${test.args[arg]}${count >= 0 ? `\n${encoding.countParameter} = ${test.args[count]}` : ""}`;
      else if (slot !== undefined) {
        try {
          const values = parseTypedField(sig.returnType, test.expected);
          if (Array.isArray(values) && values[slot] !== undefined)
            source = JSON.stringify(values[slot]);
        } catch {
          /* The concrete field reports incomplete output. */
        }
      }
      return (
        <GraphCaseField
          key={target}
          label={graphLabel(target)}
          encoding={encoding}
          form={form ?? graphToForm(graph, encoding)}
          graph={test.graphs?.[target]}
          error={targetIndex === 0 ? test.graphError : undefined}
          limit={p.limits.maxCollectionElements}
          solverPreview={
            encoding.kind === "custom" || source === undefined
              ? undefined
              : { kind: arg >= 0 ? "input" : "output", source }
          }
          onChange={(form) => applyForm(target, form)}
        />
      );
    });
    const needsNative = !test.graphForms?.[name] || encodings[name]?.kind === "custom";
    return (
      <div key={name} className="graph-field-group">
        {sections}
        {needsNative && native}
      </div>
    );
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
          renderCaseField={graphTargets.length ? renderGraphField : undefined}
          customCaseDetails={(index) => {
            const test = values[collection][index];
            if (!test) return null;
            return (
              <>
                {collection === "public" && (
                  <label className="typed-case-field admin-example-explanation">
                    <span>
                      <Icon name="samples" /> Example explanation <small>Optional</small>
                    </span>
                    <textarea
                      rows={2}
                      placeholder="Explain why this example produces the expected output."
                      value={explanations[test.id] ?? ""}
                      onChange={(event) => {
                        const next = { ...explanations, [test.id]: event.target.value };
                        setExplanations(next);
                        change(values.public, next);
                      }}
                    />
                  </label>
                )}
              </>
            );
          }}
          selectedCustomId={selected[collection]}
          onSelectCustomCase={(value) =>
            setSelected((current) => ({ ...current, [collection]: value }))
          }
        />
      </div>
    </div>
  );
}
