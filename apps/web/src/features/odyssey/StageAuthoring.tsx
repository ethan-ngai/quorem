/** @file StageAuthoring.tsx @description Ordered step/method editing with typed stateful test suites. @module odyssey */
import { randomUUID } from "../../randomUUID";
import { useId, useState } from "react";
import { SignatureFields } from "../admin/SignatureFields";
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { SequenceTestsEditor } from "./SequenceTestsEditor";
import { methodDraft, sequenceDraft, updateMethod, type StageDraft } from "./stageDrafts";
import "./authoring.css";

export function StageAuthoring({
  value,
  onChange,
  onValidityChange,
}: {
  value: StageDraft[];
  onChange: (stages: StageDraft[]) => void;
  onValidityChange: (id: string, invalid: boolean) => void;
}) {
  const id = useId();
  const [requested, setRequested] = useState<string>();
  const selected = value.find((stage) => stage.id === requested) ?? value[0]!;
  const [selectedCases, setSelectedCases] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<Record<string, "examples" | "tests">>({});
  function patch(stage: StageDraft, update: Partial<StageDraft>) {
    onChange(value.map((item) => (item.id === stage.id ? { ...item, ...update } : item)));
  }
  function selectAt(index: number) {
    setRequested(value[index]!.id);
    document.getElementById(`${id}-tab-${value[index]!.id}`)?.focus();
  }
  return (
    <section className="stage-authoring">
      <div className="stage-authoring-nav">
        <div className="result-tabs" role="tablist" aria-label="Question steps">
          {value.map((stage, index) => (
            <button
              type="button"
              role="tab"
              key={stage.id}
              id={`${id}-tab-${stage.id}`}
              aria-controls={`${id}-panel-${stage.id}`}
              aria-selected={selected === stage}
              tabIndex={selected === stage ? 0 : -1}
              onClick={() => setRequested(stage.id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                selectAt(
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? value.length - 1
                      : (index + (event.key === "ArrowLeft" ? -1 : 1) + value.length) %
                        value.length,
                );
              }}
            >
              Step {index + 1}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="quiet-button"
          disabled={value.length >= 8}
          onClick={() => {
            const method = methodDraft({
              className: "Solution",
              methodName: `method${value.flatMap((stage) => stage.methods).length + 1}`,
              parameters: [],
              returnType: "int",
            });
            const stage: StageDraft = {
              id: randomUUID(),
              title: `Step ${value.length + 1}`,
              statement: "",
              methods: [method],
              examples: [sequenceDraft(method)],
              tests: [sequenceDraft(method)],
            };
            onChange([...value, stage]);
            setRequested(stage.id);
          }}
        >
          <Icon name="plus" />
          Add step
        </button>
      </div>
      {value.map((stage, index) => {
        const methods = value.slice(0, index + 1).flatMap((stage) => stage.methods);
        const collection = collections[stage.id] ?? "examples";
        return (
          <fieldset
            className="admin-fields"
            role="tabpanel"
            id={`${id}-panel-${stage.id}`}
            aria-labelledby={`${id}-tab-${stage.id}`}
            key={stage.id}
            hidden={selected !== stage}
            disabled={selected !== stage}
          >
            <div className="stage-authoring-heading">
              <h3>Step {index + 1}</h3>
              {index === value.length - 1 && index > 0 && (
                <Tooltip content="Remove step">
                  <button
                    type="button"
                    className="icon-button destructive-icon"
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() => onChange(value.slice(0, -1))}
                  >
                    <Icon name="trash" />
                  </button>
                </Tooltip>
              )}
            </div>
            <label className="admin-field">
              <span>Step name</span>
              <input
                required
                maxLength={160}
                value={stage.title}
                onChange={(event) => patch(stage, { title: event.target.value })}
              />
            </label>
            <label className="admin-field">
              <span>Instructions for this step</span>
              <textarea
                required
                rows={3}
                value={stage.statement}
                onChange={(event) => patch(stage, { statement: event.target.value })}
              />
            </label>
            <h3>Methods added in this step</h3>
            {stage.methods.map((method) => (
              <details className="admin-language" open key={method.id}>
                <summary>{method.signature.methodName || "New method"}</summary>
                <SignatureFields
                  value={method.signature}
                  allowVoid
                  onValidityChange={onValidityChange}
                  onChange={(signature) => onChange(updateMethod(value, method.id, signature))}
                />
                <button
                  type="button"
                  className="quiet-button"
                  disabled={stage.methods.length <= 1}
                  onClick={() =>
                    patch(stage, { methods: stage.methods.filter((item) => item.id !== method.id) })
                  }
                >
                  Remove method
                </button>
              </details>
            ))}
            <button
              type="button"
              className="quiet-button"
              disabled={stage.methods.length >= 16}
              onClick={() =>
                patch(stage, {
                  methods: [
                    ...stage.methods,
                    methodDraft({
                      className: "Solution",
                      methodName: `method${methods.length + 1}`,
                      parameters: [],
                      returnType: "int",
                    }),
                  ],
                })
              }
            >
              <Icon name="plus" />
              Add method
            </button>
            <div className="authoring-test-collections">
              <div className="result-tabs" role="tablist" aria-label={`Step ${index + 1} tests`}>
                {(["examples", "tests"] as const).map((tab, tabIndex) => (
                  <button
                    type="button"
                    role="tab"
                    key={tab}
                    id={`${id}-${stage.id}-${tab}`}
                    aria-controls={`${id}-${stage.id}-cases`}
                    aria-selected={collection === tab}
                    tabIndex={collection === tab ? 0 : -1}
                    onClick={() => setCollections({ ...collections, [stage.id]: tab })}
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? "examples"
                          : event.key === "End"
                            ? "tests"
                            : tabIndex === 0
                              ? "tests"
                              : "examples";
                      setCollections({ ...collections, [stage.id]: next });
                      document.getElementById(`${id}-${stage.id}-${next}`)?.focus();
                    }}
                  >
                    <Icon name={tab === "tests" ? "lock" : "samples"} />
                    {tab === "examples" ? "Test cases" : "Private tests"}
                  </button>
                ))}
              </div>
              <p className="case-stale">Calls share one object. Each case starts fresh.</p>
              <div
                role="tabpanel"
                id={`${id}-${stage.id}-cases`}
                aria-labelledby={`${id}-${stage.id}-${collection}`}
              >
                <SequenceTestsEditor
                  key={`${stage.id}-${collection}`}
                  selectedId={selectedCases[`${stage.id}-${collection}`]}
                  onSelect={(id) =>
                    setSelectedCases((current) => ({
                      ...current,
                      [`${stage.id}-${collection}`]: id,
                    }))
                  }
                  label={`Step ${index + 1} ${collection === "examples" ? "test cases" : "private tests"}`}
                  methods={methods}
                  value={stage[collection]}
                  onChange={(cases) => patch(stage, { [collection]: cases })}
                />
              </div>
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}
