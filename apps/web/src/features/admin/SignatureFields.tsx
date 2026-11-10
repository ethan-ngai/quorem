import { TextInput } from "../../ui/TextControl";
import { inputConstraints, validateInput } from "../../ui/input-constraints";
import { PersistentNotice } from "../../ui/PersistentNotice";
/** @file SignatureFields.tsx @description Shared typed method contract controls for question authors. @module admin */
import {
  ArrowDownToLine,
  ChevronRight,
  FileText,
  Hash,
  ListOrdered,
  Plus,
  Shuffle,
  Trash2,
  TriangleAlert,
  Unlink,
  Link2,
  CornerDownLeft,
} from "lucide-react";
import { isMatrixType } from "@quorem/contracts/question-type";
import { nodeType } from "@quorem/contracts/node-type";
import type { Signature } from "@quorem/contracts";
import {
  GRAPH_RETURN,
  GRAPH_RETURN_LIST,
  graphReturnSlot,
  type GraphEncoding,
} from "@quorem/questions";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Tooltip } from "../../ui/Tooltip";
import { MethodSignature } from "../editor/components/MethodSignature";
import { TypeSyntaxText } from "../editor/components/TypeSyntax";
import { ValueTypeField } from "./ValueTypeField";
import {
  defaultGraphEncoding,
  GraphEncodingFields,
  GraphSettingsMenu,
  LegacyReturnGraphSlots,
  withGraphEncoding,
} from "./GraphEncodingFields";
export function SignatureFields({
  value,
  onChange: onSignatureChange,
  allowVoid = false,
  disabled = false,
  onValidityChange,
  previewControl,
  graphAuthoring = false,
}: {
  value: Signature;
  onChange: (value: Signature) => void;
  allowVoid?: boolean;
  disabled?: boolean;
  previewControl?: ReactNode;
  graphAuthoring?: boolean;
  onValidityChange?: (label: string, invalid: boolean) => void;
}) {
  const nodeParameters = value.parameters.filter(({ type }) => nodeType(type));
  const canReturnReference = nodeParameters.some(({ type }) => type === value.returnType);
  const onChange = (next: Signature) => {
    const nodes = next.parameters.filter(({ type }) => nodeType(type));
    const mode = !nodes.length
      ? undefined
      : next.nodeReferences === "return" && !nodes.some(({ type }) => type === next.returnType)
        ? "arguments"
        : next.nodeReferences;
    onSignatureChange({ ...next, nodeReferences: mode });
  };
  const encodings = value.graphEncodings ?? {};
  const graphBindings = Object.entries(encodings);
  const returnSlots = graphBindings.filter(([name]) => graphReturnSlot(name) !== undefined);
  const hasReturnSlots = returnSlots.length > 0;
  const hasPresetSlot = returnSlots.some(([, { kind }]) => kind !== "custom");
  const listReturn = /^(list|array)</.test(value.returnType);
  const returnList = encodings[GRAPH_RETURN_LIST];
  const returnElement = value.returnType.slice(value.returnType.indexOf("<") + 1, -1);
  const legacySlots = hasReturnSlots && !returnList;
  const exceptions = value.throws ?? [];
  const namesId = useId();
  const addParameter = useRef<HTMLButtonElement>(null);
  const addException = useRef<HTMLButtonElement>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const parameterNames = value.parameters.map(({ name }, index) => nameDrafts[index] ?? name);
  const invalidMethod = !validateInput(value.methodName, inputConstraints.identifier).success;
  const invalidParameter = (name: string, names = parameterNames) =>
    !validateInput(name, inputConstraints.identifier).success ||
    names.filter((parameter) => parameter === name).length > 1;
  const invalidNames = invalidMethod || parameterNames.some((name) => invalidParameter(name));
  const editingInvalidNames = Object.keys(nameDrafts).length > 0;
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => {
    validity.current?.(namesId, invalidNames);
  }, [namesId, invalidNames]);
  useEffect(() => () => validity.current?.(namesId, false), [namesId]);
  function renameParameter(index: number, name: string) {
    const drafts = { ...nameDrafts, [index]: name };
    const parameters = value.parameters.map((parameter, position) => ({
      ...parameter,
      name: drafts[position] ?? parameter.name,
    }));
    const names = parameters.map(({ name }) => name);
    if (names.some((name) => invalidParameter(name, names))) {
      setNameDrafts(drafts);
      return;
    }
    setNameDrafts({});
    onChange({ ...value, parameters });
  }
  const updateParameter = (index: number, patch: Partial<Signature["parameters"][number]>) =>
    onChange({
      ...value,
      parameters: value.parameters.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    });
  const updateException = (index: number, patch: Partial<(typeof exceptions)[number]>) =>
    onChange({
      ...value,
      throws: exceptions.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    });
  function changeEncoding(name: string, encoding?: GraphEncoding) {
    onChange(withGraphEncoding(value, name, encoding));
  }
  function withoutReturnGraphs() {
    const next = graphBindings.filter(
      ([key]) => key !== GRAPH_RETURN_LIST && graphReturnSlot(key) === undefined,
    );
    return { ...value, graphEncodings: next.length ? Object.fromEntries(next) : undefined };
  }
  function typeField(
    name: string,
    label: string,
    type: string,
    updateType: (type: string, signature: Signature) => Signature,
  ) {
    const isReturn = name === GRAPH_RETURN;
    const listEncoding = isReturn ? returnList : undefined;
    const target = listEncoding ? GRAPH_RETURN_LIST : name;
    const title = isReturn ? "Return value" : name;
    const encoding = encodings[target];
    function withoutGraph() {
      if (!encoding) return value;
      if (!listEncoding) return withGraphEncoding(value, target);
      return withoutReturnGraphs();
    }
    if (!graphAuthoring && encoding && encoding.kind !== "custom")
      return <PresetType type={type} note="Set by graph" />;
    const selector = (
      <ValueTypeField
        hideLabel
        label={label}
        value={type}
        allowVoid={isReturn && allowVoid}
        disabled={disabled}
        graph={
          graphAuthoring && !listEncoding
            ? {
                selected: !!encoding,
                onSelect: () => {
                  if (!encoding)
                    changeEncoding(
                      name,
                      defaultGraphEncoding(type, isReturn && value.nodeReferences === "return"),
                    );
                },
              }
            : undefined
        }
        elementGraph={
          graphAuthoring && isReturn && listReturn && !encodings[GRAPH_RETURN]
            ? {
                selected: !!listEncoding,
                onSelect: () => {
                  if (!listEncoding)
                    changeEncoding(GRAPH_RETURN_LIST, defaultGraphEncoding(returnElement));
                },
              }
            : undefined
        }
        onValidityChange={onValidityChange}
        onChange={(next) => onChange(updateType(next, graphAuthoring ? withoutGraph() : value))}
      />
    );
    if (!encoding || !graphAuthoring) return selector;
    return (
      <div className="graph-signature-choice" data-graph-list={!!listEncoding || undefined}>
        <div className="graph-signature-picker">
          {selector}
          <GraphSettingsMenu title={title} disabled={disabled}>
            <GraphEncodingFields
              signature={value}
              name={target}
              title={title}
              encoding={encoding}
              disabled={disabled}
              customType={
                encoding.kind === "custom" && (
                  <ValueTypeField
                    label={listEncoding ? "Solver element type" : "Solver type"}
                    value={listEncoding ? returnElement : type}
                    disabled={disabled || (!!listEncoding && hasPresetSlot)}
                    onValidityChange={onValidityChange}
                    onChange={(next) =>
                      onChange(
                        updateType(listEncoding ? `${type.split("<")[0]}<${next}>` : next, value),
                      )
                    }
                  />
                )
              }
              onChange={(next) => changeEncoding(target, next)}
            />
          </GraphSettingsMenu>
        </div>
        <code className="code-literal graph-signature-native">
          <TypeSyntaxText text={type} />
        </code>
      </div>
    );
  }
  const updateReturnType = (returnType: string, signature: Signature) => ({
    ...signature,
    returnType,
    outputOrder: /^(list|array)</.test(returnType) ? signature.outputOrder : undefined,
  });
  function updateParameterType(index: number, type: string, signature: Signature) {
    return {
      ...signature,
      parameters: signature.parameters.map((item, position) =>
        position === index
          ? { ...item, type, input: type === item.type ? item.input : undefined }
          : item,
      ),
    };
  }
  return (
    <fieldset className="admin-fields" aria-labelledby={`${namesId}-method`}>
      <div className="admin-method-heading">
        <span id={`${namesId}-method`}>Method</span>
        {previewControl}
        <PersistentNotice
          id={`${namesId}-error`}
          label="Check signature"
          message={invalidNames ? "Use valid identifiers and unique parameter names." : undefined}
        />
      </div>
      <div className="authoring-signature-line">
        <MethodSignature signature={value} showDocumentation />
      </div>
      <div className="authoring-signature-fields">
        <label className="admin-field">
          <span>Method name</span>
          <TextInput
            unstyled
            constraint={inputConstraints.identifier}
            maxLength={80}
            className="admin-code"
            value={value.methodName}
            aria-invalid={invalidMethod}
            aria-describedby={invalidMethod ? `${namesId}-error` : undefined}
            onChange={(event) => onChange({ ...value, methodName: event.target.value })}
            required
            pattern="[a-zA-Z_][a-zA-Z0-9_]*"
          />
        </label>
        <div className="admin-field">
          <span>Return type</span>
          {legacySlots ? (
            <div className="authoring-derived-type">
              <code className="code-literal">
                <TypeSyntaxText text={value.returnType} />
              </code>
            </div>
          ) : (
            typeField(GRAPH_RETURN, "Return type", value.returnType, updateReturnType)
          )}
          {legacySlots && !hasPresetSlot && listReturn && (
            <ValueTypeField
              label="Slot element type"
              value={value.returnType.slice(value.returnType.indexOf("<") + 1, -1)}
              disabled={disabled}
              onValidityChange={onValidityChange}
              onChange={(type) =>
                onChange({ ...value, returnType: `${value.returnType.split("<")[0]}<${type}>` })
              }
            />
          )}
          {graphAuthoring && legacySlots && listReturn && (
            <>
              <LegacyReturnGraphSlots slots={returnSlots} />
              <button
                type="button"
                className="quiet-button"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    withGraphEncoding(withoutReturnGraphs(), GRAPH_RETURN_LIST, returnSlots[0]![1]),
                  )
                }
              >
                Use one graph format
              </button>
            </>
          )}
        </div>
        {listReturn && (
          <div className="admin-field authoring-return-order">
            <span>Return order</span>
            <SegmentedControl<NonNullable<Signature["outputOrder"]>>
              label="Return order"
              disabled={disabled}
              value={value.outputOrder ?? "ordered"}
              onChange={(outputOrder) => onChange({ ...value, outputOrder })}
              options={[
                {
                  value: "ordered",
                  label: "Ordered",
                  icon: <ListOrdered size={15} aria-hidden="true" />,
                },
                {
                  value: "unordered",
                  label: "Any order",
                  disabled: hasReturnSlots || !!returnList,
                  hint:
                    hasReturnSlots || returnList
                      ? "Graph return slots require ordered results."
                      : undefined,
                  icon: <Shuffle size={15} aria-hidden="true" />,
                },
              ]}
            />
          </div>
        )}
        {nodeParameters.length > 0 && (
          <div className="admin-field authoring-node-identity">
            <span>Node identity</span>
            <SegmentedControl<"off" | NonNullable<Signature["nodeReferences"]>>
              label="Node identity"
              compact
              disabled={disabled}
              value={value.nodeReferences ?? "off"}
              onChange={(mode) =>
                onChange({ ...value, nodeReferences: mode === "off" ? undefined : mode })
              }
              options={[
                {
                  value: "off",
                  label: "Independent",
                  icon: <Unlink size={15} aria-hidden="true" />,
                  hint: "Separate node structures.",
                },
                {
                  value: "arguments",
                  label: "Shared inputs",
                  icon: <Link2 size={15} aria-hidden="true" />,
                  hint: "Inputs can reference existing nodes.",
                },
                ...(canReturnReference
                  ? [
                      {
                        value: "return" as const,
                        label: "Return identity",
                        icon: <CornerDownLeft size={15} aria-hidden="true" />,
                        hint: "Shared inputs; compare the returned node by identity.",
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
      <div className="authoring-method-section-heading">
        <h3>Parameters</h3>
        <button
          type="button"
          className="quiet-button"
          ref={addParameter}
          disabled={disabled || editingInvalidNames || value.parameters.length >= 16}
          onClick={() => {
            let next = value.parameters.length + 1;
            while (value.parameters.some(({ name }) => name === `arg${next}`)) next++;
            onChange({
              ...value,
              parameters: [...value.parameters, { name: `arg${next}`, type: "int" }],
            });
          }}
        >
          <Plus size={15} aria-hidden="true" /> Add parameter
        </button>
      </div>
      <AnimatedRows
        items={value.parameters}
        focusFallback={addParameter}
        heading={
          <div className="authoring-parameter-row authoring-method-columns" aria-hidden="true">
            <span>Name</span>
            <span>Type</span>
            <span>Description</span>
          </div>
        }
        renderRow={(parameter, index) => (
          <div className="authoring-parameter-row">
            <div className="admin-field">
              <TextInput
                unstyled
                constraint={inputConstraints.identifier}
                maxLength={80}
                aria-label={`Parameter ${index + 1} name`}
                className="admin-code"
                value={parameterNames[index]}
                aria-invalid={invalidParameter(parameterNames[index]!)}
                aria-describedby={
                  invalidParameter(parameterNames[index]!) ? `${namesId}-error` : undefined
                }
                required
                pattern="[a-zA-Z_][a-zA-Z0-9_]*"
                onChange={(event) => renameParameter(index, event.target.value)}
              />
            </div>
            <div className="authoring-parameter-type">
              {graphBindings.some(([, binding]) => binding.countParameter === parameter.name) ? (
                <PresetType
                  type={parameter.type}
                  note="Graph node count"
                  icon={<Hash size={14} aria-hidden="true" />}
                />
              ) : (
                typeField(
                  parameter.name,
                  `Parameter ${index + 1} type`,
                  parameter.type,
                  (type, signature) => updateParameterType(index, type, signature),
                )
              )}
              {isMatrixType(parameter.type) && (
                <SegmentedControl
                  compact
                  label={`${parameter.name} array layout`}
                  value={parameter.input?.layout ?? "inline"}
                  options={[
                    { value: "inline", label: "Inline" },
                    { value: "rows", label: "Rows", hint: "One row per line" },
                  ]}
                  disabled={disabled || editingInvalidNames}
                  onChange={(layout) =>
                    updateParameter(index, {
                      input: { preset: "default", ...parameter.input, layout },
                    })
                  }
                />
              )}
            </div>
            <div className="admin-field authoring-parameter-description">
              <input
                aria-label={`Parameter ${index + 1} description`}
                placeholder="Optional description"
                className="code-doc-comment"
                value={parameter.description ?? ""}
                onChange={(event) => updateParameter(index, { description: event.target.value })}
              />
            </div>
            <Tooltip content="Remove parameter">
              <button
                type="button"
                className="icon-button destructive-icon authoring-parameter-remove"
                aria-label={`Remove parameter ${parameter.name}`}
                disabled={disabled || editingInvalidNames}
                onClick={() =>
                  onChange({
                    ...value,
                    parameters: value.parameters.filter((_, position) => position !== index),
                  })
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}
      />
      <details className="disclosure authoring-method-docs">
        <summary>
          <FileText size={16} aria-hidden="true" />
          Method documentation
          <ChevronRight className="disclosure-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="authoring-docs-fields">
          <label className="admin-field">
            <span>Summary</span>
            <textarea
              rows={2}
              placeholder="What this method does"
              className="code-doc-comment"
              value={value.description ?? ""}
              onChange={(event) => onChange({ ...value, description: event.target.value })}
            />
          </label>
          {value.returnType !== "void" && (
            <label className="admin-field">
              <span>
                <ArrowDownToLine size={14} aria-hidden="true" /> Returns
              </span>
              <textarea
                rows={2}
                placeholder="What the returned value means"
                className="code-doc-comment"
                value={value.returns ?? ""}
                onChange={(event) => onChange({ ...value, returns: event.target.value })}
              />
            </label>
          )}
        </div>
        <div className="authoring-method-section-heading">
          <h3>
            <TriangleAlert size={16} aria-hidden="true" /> Exceptions
          </h3>
          <button
            type="button"
            className="quiet-button"
            ref={addException}
            onClick={() =>
              onChange({ ...value, throws: [...exceptions, { type: "", description: "" }] })
            }
          >
            <Plus size={15} aria-hidden="true" /> Add exception
          </button>
        </div>
        <AnimatedRows
          items={exceptions}
          focusFallback={addException}
          heading={
            <div className="authoring-exception-row authoring-method-columns" aria-hidden="true">
              <span>Type</span>
              <span>When thrown</span>
            </div>
          }
          renderRow={(exception, index) => (
            <div className="authoring-exception-row">
              <div className="admin-field">
                <input
                  aria-label={`Exception ${index + 1} type`}
                  className="code-doc-comment"
                  placeholder="ValueError"
                  value={exception.type}
                  onChange={(event) => updateException(index, { type: event.target.value })}
                />
              </div>
              <div className="admin-field">
                <input
                  aria-label={`Exception ${index + 1} description`}
                  className="code-doc-comment"
                  placeholder="When it is thrown"
                  value={exception.description}
                  onChange={(event) => updateException(index, { description: event.target.value })}
                />
              </div>
              <Tooltip content="Remove exception">
                <button
                  type="button"
                  className="icon-button destructive-icon"
                  aria-label={`Remove exception ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      throws: exceptions.filter((_, position) => position !== index),
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          )}
        />
      </details>
    </fieldset>
  );
}

function PresetType({ type, note, icon }: { type: string; note: string; icon?: ReactNode }) {
  return (
    <div className="authoring-derived-type">
      <code className="code-literal">
        <TypeSyntaxText text={type} />
      </code>
      {icon ? (
        <Tooltip content={note}>
          <span className="graph-count-icon" tabIndex={0} aria-label={note}>
            {icon}
          </span>
        </Tooltip>
      ) : (
        <span>{note}</span>
      )}
    </div>
  );
}
