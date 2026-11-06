import { TextInput } from "../../ui/TextControl";
import { inputConstraints, withMaxBytes } from "../../ui/input-constraints";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
/** @file StageAuthoring.tsx @description Ordered step/method editing with typed stateful test suites. @module odyssey */
import { randomUUID } from "../../randomUUID";
import { useId, useState } from "react";
import { SignatureFields } from "../admin/SignatureFields";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Icon } from "../../ui/Icon";
import { Tooltip } from "../../ui/Tooltip";
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
  return (
    <section className="stage-authoring">
      <div className="stage-authoring-nav">
        <AuthoringTabs
          label="Question steps"
          appearance="default"
          value={selected?.id ?? ""}
          onChange={setRequested}
          tabId={(stageId) => `${id}-tab-${stageId}`}
          panelId={(stageId) => `${id}-panel-${stageId}`}
          tabs={value.map((stage, index) => ({ value: stage.id, label: `Step ${index + 1}` }))}
        />
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
              <TextInput
                unstyled
                constraint={withMaxBytes(inputConstraints.name, 160)}
                required
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
            <AnimatedRows
              items={stage.methods}
              renderRow={(method) => (
                <details className="disclosure admin-language" open>
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
                      patch(stage, {
                        methods: stage.methods.filter((item) => item.id !== method.id),
                      })
                    }
                  >
                    Remove method
                  </button>
                </details>
              )}
            />
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
              <AuthoringTabs
                id={`${id}-${stage.id}`}
                label={`Step ${index + 1} tests`}
                appearance="default"
                value={collection}
                onChange={(tab) => setCollections({ ...collections, [stage.id]: tab })}
                panelId={() => `${id}-${stage.id}-cases`}
                tabs={[
                  { value: "examples", icon: <Icon name="samples" />, label: "Examples" },
                  { value: "tests", icon: <Icon name="lock" />, label: "Private tests" },
                ]}
              />
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
                  label={`Step ${index + 1} ${collection === "examples" ? "examples" : "private tests"}`}
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
