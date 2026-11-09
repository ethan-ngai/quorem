import { TextInput } from "../../ui/TextControl";
import { inputConstraints, validateInput } from "../../ui/input-constraints";
import { PersistentNotice } from "../../ui/PersistentNotice";
/** @file SignatureFields.tsx @description Shared typed method contract controls for question authors. @module admin */
import {
  ArrowDownToLine,
  ChevronRight,
  FileText,
  ListOrdered,
  Plus,
  Shuffle,
  Trash2,
  TriangleAlert,
  Unlink,
  Link2,
  CornerDownLeft,
} from "lucide-react";
import { nodeType } from "@quorem/contracts/node-type";
import type { Signature } from "@quorem/contracts";
import { GRAPH_RETURN, graphReturnSlot, type GraphEncoding } from "@quorem/questions";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Tooltip } from "../../ui/Tooltip";
import { MethodSignature } from "../editor/components/MethodSignature";
import { ValueTypeField } from "./ValueTypeField";
import {
  defaultGraphEncoding,
  GraphEncodingFields,
  ReturnGraphSlots,
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
  const returnGraph = encodings[GRAPH_RETURN];
  const canAddSlot =
    graphAuthoring && listReturn && !returnGraph && value.outputOrder !== "unordered";
  const exceptions = value.throws ?? [];
  const namesId = useId();
  const addParameter = useRef<HTMLButtonElement>(null);
  const addException = useRef<HTMLButtonElement>(null);
  const invalidMethod = !validateInput(value.methodName, inputConstraints.identifier).success;
  const invalidParameter = (name: string) =>
    !validateInput(name, inputConstraints.identifier).success ||
    value.parameters.filter((parameter) => parameter.name === name).length > 1;
  const invalidNames = invalidMethod || value.parameters.some(({ name }) => invalidParameter(name));
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => {
    validity.current?.(namesId, invalidNames);
  }, [namesId, invalidNames]);
  useEffect(() => () => validity.current?.(namesId, false), [namesId]);
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
  function graphSettings(
    name: string,
    title: string,
    encoding: GraphEncoding,
    customType: ReactNode,
  ) {
    return (
      <details className="graph-signature-settings">
        <summary aria-label={`Graph settings for ${title}`}>Graph settings</summary>
        <GraphEncodingFields
          signature={value}
          name={name}
          title={title}
          encoding={encoding}
          disabled={disabled}
          customType={customType}
          onChange={(next) => changeEncoding(name, next)}
        />
      </details>
    );
  }
  function typeField(
    name: string,
    label: string,
    type: string,
    updateType: (type: string, signature: Signature) => Signature,
  ) {
    const isReturn = name === GRAPH_RETURN;
    const encoding = encodings[name];
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
          graphAuthoring
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
        onValidityChange={onValidityChange}
        onChange={(next) =>
          onChange(
            updateType(next, graphAuthoring && encoding ? withGraphEncoding(value, name) : value),
          )
        }
      />
    );
    if (!encoding || !graphAuthoring) return selector;
    return (
      <div className="graph-signature-choice">
        {selector}
        <span>of</span>
        <code className="graph-signature-native">{type}</code>
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
          {hasPresetSlot ? (
            <PresetType type={value.returnType} note="Shared by return slots" />
          ) : hasReturnSlots && listReturn ? (
            <ValueTypeField
              hideLabel
              label="Return slot type"
              value={value.returnType.slice(value.returnType.indexOf("<") + 1, -1)}
              disabled={disabled}
              onValidityChange={onValidityChange}
              onChange={(type) =>
                onChange({ ...value, returnType: `${value.returnType.split("<")[0]}<${type}>` })
              }
            />
          ) : (
            typeField(GRAPH_RETURN, "Return type", value.returnType, updateReturnType)
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
                  disabled: hasReturnSlots,
                  hint: hasReturnSlots ? "Graph return slots require ordered results." : undefined,
                  icon: <Shuffle size={15} aria-hidden="true" />,
                },
              ]}
            />
          </div>
        )}
        {returnGraph &&
          graphAuthoring &&
          graphSettings(
            GRAPH_RETURN,
            "Return value",
            returnGraph,
            <ValueTypeField
              label="Solver return type"
              value={value.returnType}
              disabled={disabled}
              onValidityChange={onValidityChange}
              onChange={(type) => onChange(updateReturnType(type, value))}
            />,
          )}
        {graphAuthoring && (canAddSlot || hasReturnSlots) && (
          <ReturnGraphSlots
            signature={value}
            slots={returnSlots}
            canAdd={canAddSlot}
            disabled={disabled}
            onChange={changeEncoding}
          />
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
          disabled={value.parameters.length >= 16}
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
                value={parameter.name}
                aria-invalid={invalidParameter(parameter.name)}
                aria-describedby={invalidParameter(parameter.name) ? `${namesId}-error` : undefined}
                required
                pattern="[a-zA-Z_][a-zA-Z0-9_]*"
                onChange={(event) => updateParameter(index, { name: event.target.value })}
              />
            </div>
            {graphBindings.some(([, binding]) => binding.countParameter === parameter.name) ? (
              <PresetType type={parameter.type} note="Graph node count" />
            ) : (
              typeField(
                parameter.name,
                `Parameter ${index + 1} type`,
                parameter.type,
                (type, signature) => updateParameterType(index, type, signature),
              )
            )}
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
            {graphAuthoring &&
              encodings[parameter.name] &&
              graphSettings(
                parameter.name,
                parameter.name,
                encodings[parameter.name]!,
                <ValueTypeField
                  label={`Solver type for ${parameter.name}`}
                  value={parameter.type}
                  disabled={disabled}
                  onValidityChange={onValidityChange}
                  onChange={(type) => onChange(updateParameterType(index, type, value))}
                />,
              )}
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

function PresetType({ type, note }: { type: string; note: string }) {
  return (
    <div className="authoring-derived-type">
      <code>{type}</code>
      <span>{note}</span>
    </div>
  );
}
