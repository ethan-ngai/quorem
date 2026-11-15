import { PersistentNotice } from "../../ui/PersistentNotice";
import { NodeReferenceScope } from "../editor/components/NodePreview";
/** @file SequenceTestsEditor.tsx @description Typed call-sequence authoring inside the shared case browser. @module odyssey */
import { SelectField } from "../../ui/SelectField";
import { CaseBrowserLayout } from "../editor/components/CaseBrowserLayout";
import { CaseFields } from "../editor/components/CaseFields";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Icon } from "../../ui/Icon";
import { Tooltip } from "../../ui/Tooltip";
import {
  callDraft,
  sequenceDraft,
  type MethodDraft,
  type SequenceDraft,
  type CallDraft,
} from "./stageDrafts";

export function SequenceTestsEditor({
  methods,
  value,
  onChange,
  label,
  selectedId,
  onSelect,
}: {
  methods: MethodDraft[];
  value: SequenceDraft[];
  onChange: (value: SequenceDraft[]) => void;
  label: string;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const selected = value.find((test) => test.id === selectedId) ?? value[0];
  const index = selected ? value.indexOf(selected) : 0;
  function patchCall(callId: string, patch: Partial<CallDraft>) {
    onChange(
      value.map((test) =>
        test.id === selected?.id
          ? {
              ...test,
              calls: test.calls.map((call) => (call.id === callId ? { ...call, ...patch } : call)),
            }
          : test,
      ),
    );
  }
  return (
    <div className="authoring-case-browser sequence-authoring">
      <CaseBrowserLayout
        railLabel={label}
        selection={selected?.id}
        rail={
          <>
            {value.map((test, index) => (
              <button
                type="button"
                key={test.id}
                className="quiet-button selection-feedback case-selector"
                aria-pressed={test === selected}
                onClick={() => onSelect(test.id)}
              >
                Case {index + 1}
              </button>
            ))}
            <button
              type="button"
              className="quiet-button selection-feedback case-selector add-case"
              disabled={!methods.length || value.length >= 20}
              onClick={() => {
                const test = sequenceDraft(methods[0]!);
                onChange([...value, test]);
                onSelect(test.id);
              }}
            >
              <Icon name="plus" />
              Add case
            </button>
          </>
        }
      >
        {selected ? (
          <>
            <div className="custom-case-heading">
              <span>Case {index + 1}</span>
              <Tooltip content="Remove case">
                <button
                  type="button"
                  className="icon-button destructive-icon"
                  aria-label={`Remove case ${index + 1}`}
                  disabled={value.length <= 1}
                  onClick={() => onChange(value.filter((test) => test.id !== selected.id))}
                >
                  <Icon name="trash" />
                </button>
              </Tooltip>
            </div>
            <AnimatedRows
              key={selected.id}
              items={selected.calls}
              className="sequence-call-list"
              renderRow={(call, callIndex) => {
                const method = methods.find((method) => method.id === call.methodId);
                return (
                  <div className="sequence-call-editor">
                    <div className="sequence-call-heading">
                      <span>Call {callIndex + 1}</span>
                      <SelectField
                        label={`Method for call ${callIndex + 1}`}
                        value={call.methodId}
                        options={methods.map((method) => ({
                          value: method.id,
                          label: method.signature.methodName || "Unnamed method",
                        }))}
                        onChange={(methodId) => {
                          const next = methods.find((method) => method.id === methodId)!;
                          patchCall(call.id, { ...callDraft(next), id: call.id });
                        }}
                      />
                      <PersistentNotice
                        label="Choose a method"
                        message={!method ? "Choose an available method for this call." : undefined}
                      />
                      <Tooltip content="Remove call">
                        <button
                          type="button"
                          className="icon-button destructive-icon"
                          aria-label={`Remove call ${callIndex + 1}`}
                          disabled={selected.calls.length <= 1}
                          onClick={() =>
                            onChange(
                              value.map((test) =>
                                test.id === selected.id
                                  ? {
                                      ...test,
                                      calls: test.calls.filter((item) => item.id !== call.id),
                                    }
                                  : test,
                              ),
                            )
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      </Tooltip>
                    </div>
                    {method && (
                      <NodeReferenceScope key={call.id}>
                        <CaseFields
                          id={call.id}
                          signature={method.signature}
                          args={call.values.args}
                          expected={call.values.expected}
                          onChange={(patch) =>
                            patchCall(call.id, { values: { ...call.values, ...patch } })
                          }
                        />
                      </NodeReferenceScope>
                    )}
                  </div>
                );
              }}
            />
            <button
              type="button"
              className="quiet-button"
              disabled={!methods.length || selected.calls.length >= 100}
              onClick={() =>
                onChange(
                  value.map((test) =>
                    test.id === selected.id
                      ? { ...test, calls: [...test.calls, callDraft(methods[0]!)] }
                      : test,
                  ),
                )
              }
            >
              <Icon name="plus" />
              Add call
            </button>
          </>
        ) : (
          <p className="result-message">Add a case to get started.</p>
        )}
      </CaseBrowserLayout>
    </div>
  );
}
