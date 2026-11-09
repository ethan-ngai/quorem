/** @file GraphEncodingFields.tsx @description Optional per-value graph encoding controls. @module admin */
import {
  GRAPH_RETURN,
  graphPresetType,
  graphReturnSlot,
  isGraphReturn,
  type GraphEncoding,
} from "@quorem/questions";
import type { Signature } from "@quorem/contracts";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SelectField } from "../../ui/SelectField";
import { TextInput } from "../../ui/TextControl";
import { Plus, X } from "lucide-react";
import { ValueTypeField } from "./ValueTypeField";
import { Field } from "./AuthoringFields";
import "./graph-authoring.css";

const options = [
  { value: "edgeList", label: "Edge list" },
  { value: "adjacencyList", label: "Adjacency list" },
  { value: "adjacencyMatrix", label: "Adjacency matrix" },
  { value: "successor", label: "Successor array" },
  { value: "parent", label: "Parent array" },
  { value: "custom", label: "Custom" },
] satisfies { value: GraphEncoding["kind"]; label: string }[];

export function GraphEncodingFields({
  signature,
  disabled,
  onChange,
}: {
  signature: Signature;
  disabled: boolean;
  onChange: (signature: Signature) => void;
}) {
  const encodings = signature.graphEncodings ?? {};
  const returnType = signature.returnType.replaceAll("array<", "list<");
  const slots = Object.keys(encodings).filter((key) => graphReturnSlot(key) !== undefined);
  const canAddSlot =
    returnType.startsWith("list<") &&
    signature.outputOrder !== "unordered" &&
    !Object.hasOwn(encodings, GRAPH_RETURN);
  const reservedCounts = new Set(
    Object.values(encodings).map(({ countParameter }) => countParameter),
  );
  const targets = [
    ...signature.parameters,
    ...(slots.length
      ? slots.map((name) => ({ name, type: returnType.slice(5, -1) }))
      : [{ name: GRAPH_RETURN, type: signature.returnType }]),
  ];
  const targetLabel = (name: string) => {
    const slot = graphReturnSlot(name);
    return slot !== undefined
      ? `Return value [${slot}]`
      : name === GRAPH_RETURN
        ? "Return value"
        : name;
  };
  let nextSlot = 0;
  while (Object.hasOwn(encodings, `${GRAPH_RETURN}[${nextSlot}]`)) nextSlot++;
  const available = targets.filter(
    ({ name }) => !Object.hasOwn(encodings, name) && !reservedCounts.has(name),
  );
  if (canAddSlot)
    available.push({ name: `${GRAPH_RETURN}[${nextSlot}]`, type: returnType.slice(5, -1) });
  function defaultEncoding(kind: GraphEncoding["kind"], directed = false): GraphEncoding {
    return kind === "successor" ? { kind } : { kind, directed };
  }
  function change(name: string, encoding?: GraphEncoding) {
    const next = { ...encodings, ...(encoding ? { [name]: encoding } : {}) };
    if (!encoding) delete next[name];
    const type = encoding && graphPresetType(encoding.kind);
    const withEncodings = {
      ...signature,
      graphEncodings: Object.keys(next).length ? next : undefined,
    };
    if (!type) return onChange(withEncodings);
    if (isGraphReturn(name)) {
      // Return slots share the declared element type of their enclosing list.
      return onChange(
        name !== GRAPH_RETURN || returnType === type
          ? withEncodings
          : { ...withEncodings, returnType: type },
      );
    }
    onChange({
      ...withEncodings,
      parameters: signature.parameters.map((parameter) =>
        parameter.name !== name || parameter.type.replaceAll("array<", "list<") === type
          ? parameter
          : { ...parameter, type, input: undefined },
      ),
    });
  }
  return (
    <details className="disclosure authoring-options">
      <summary>
        Graphs <span className="admin-count">{Object.keys(encodings).length}</span>
      </summary>
      <div className="graph-binding-list">
        {targets
          .filter(({ name }) => Object.hasOwn(encodings, name))
          .map(({ name, type }) => {
            const output = isGraphReturn(name);
            const title = targetLabel(name);
            const encoding = encodings[name]!;
            const collection = type.replaceAll("array<", "list<");
            const choices = options.filter(({ value }) => {
              const solverType = graphPresetType(value);
              return (
                value === encoding.kind ||
                !solverType ||
                ((!output || signature.nodeReferences !== "return") &&
                  (graphReturnSlot(name) === undefined || solverType === collection))
              );
            });
            return (
              <div key={name} className="graph-binding">
                <div className="graph-binding-heading">
                  <strong>{title}</strong>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={disabled}
                    aria-label={`Remove graph for ${title}`}
                    onClick={() => change(name)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                <div className="graph-binding-options">
                  <Field label="Representation">
                    <SelectField
                      label={`Graph representation for ${title}`}
                      value={encoding.kind}
                      options={choices}
                      disabled={disabled}
                      onChange={(value) => {
                        const kind = value as GraphEncoding["kind"];
                        change(name, {
                          ...defaultEncoding(
                            kind,
                            encoding.kind === "successor" ? true : encoding.directed,
                          ),
                          nodeValueType: encoding.nodeValueType,
                          ...(kind === "custom"
                            ? {}
                            : {
                                countParameter: encoding.countParameter,
                                firstNode: encoding.firstNode,
                              }),
                        });
                      }}
                    />
                  </Field>
                  {encoding.kind !== "successor" && (
                    <div className="admin-field">
                      <span>Direction</span>
                      <SegmentedControl
                        compact
                        label={`Direction for ${title}`}
                        value={encoding.directed === undefined ? "" : String(encoding.directed)}
                        disabled={disabled}
                        options={[
                          { value: "true", label: "Directed" },
                          { value: "false", label: "Undirected" },
                        ]}
                        onChange={(value) =>
                          change(name, { ...encoding, directed: value === "true" })
                        }
                      />
                    </div>
                  )}
                  {encoding.kind !== "custom" && (
                    <>
                      {!output && (
                        <Field label="Node count argument">
                          <SelectField
                            label={`Node count for ${title}`}
                            value={encoding.countParameter ?? "$none"}
                            disabled={disabled}
                            options={[
                              { value: "$none", label: "None" },
                              ...signature.parameters
                                .filter(
                                  (p) => p.type === "int" && !encodings[p.name] && p.name !== name,
                                )
                                .map((p) => ({ value: p.name, label: p.name })),
                            ]}
                            onChange={(value) =>
                              change(name, {
                                ...encoding,
                                countParameter: value === "$none" ? undefined : value,
                              })
                            }
                          />
                        </Field>
                      )}
                      {(encoding.kind !== "edgeList" || encoding.countParameter) && (
                        <div className="admin-field">
                          <span>First node</span>
                          <SegmentedControl
                            compact
                            label={`First node for ${title}`}
                            value={String(encoding.firstNode ?? 0)}
                            disabled={disabled}
                            options={[
                              { value: "0", label: "0" },
                              { value: "1", label: "1" },
                            ]}
                            onChange={(value) =>
                              change(name, { ...encoding, firstNode: value === "1" ? 1 : 0 })
                            }
                          />
                        </div>
                      )}
                      {encoding.kind === "edgeList" && (
                        <Field label="Third column" hint="Leave empty for edge pairs">
                          <TextInput
                            aria-label={`Third column for ${title}`}
                            value={encoding.edgeValue ?? ""}
                            disabled={disabled}
                            maxLength={80}
                            placeholder="Weight"
                            onChange={(event) =>
                              change(name, {
                                ...encoding,
                                edgeValue: event.target.value || undefined,
                              })
                            }
                          />
                        </Field>
                      )}
                      {encoding.kind === "adjacencyMatrix" && (
                        <div className="admin-field">
                          <span>Diagonal default</span>
                          <SegmentedControl
                            compact
                            label={`Diagonal for ${title}`}
                            value={String(encoding.matrixDiagonal ?? 0)}
                            disabled={disabled}
                            options={[
                              { value: "0", label: "0" },
                              { value: "1", label: "1" },
                            ]}
                            onChange={(value) =>
                              change(name, { ...encoding, matrixDiagonal: value === "1" ? 1 : 0 })
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
                <details className="graph-value-types">
                  <summary>Value types</summary>
                  {(
                    [
                      "nodeValueType",
                      ...(encoding.kind === "custom" ? ["edgeValueType"] : []),
                    ] as const
                  ).map((key) => {
                    const field = key as "nodeValueType" | "edgeValueType";
                    const label = field === "nodeValueType" ? "Node value" : "Edge value";
                    return (
                      <div className="graph-value-type" key={field}>
                        {encoding[field] ? (
                          <>
                            <ValueTypeField
                              label={label}
                              value={encoding[field]}
                              disabled={disabled}
                              onChange={(value) => change(name, { ...encoding, [field]: value })}
                            />
                            <button
                              type="button"
                              className="icon-button"
                              disabled={disabled}
                              aria-label={`Clear ${label.toLowerCase()} type`}
                              onClick={() => change(name, { ...encoding, [field]: undefined })}
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="quiet-button"
                            disabled={disabled}
                            onClick={() => change(name, { ...encoding, [field]: "str" })}
                          >
                            <Plus size={14} aria-hidden="true" /> Set {label.toLowerCase()} type
                          </button>
                        )}
                      </div>
                    );
                  })}
                </details>
              </div>
            );
          })}
        {available.length > 0 && (
          <SelectField
            label="Add graph"
            value="$add"
            disabled={disabled}
            options={[
              { value: "$add", label: "Add graph", leading: <Plus size={14} aria-hidden="true" /> },
              ...available.map(({ name }) => ({ value: name, label: targetLabel(name) })),
            ]}
            onChange={(name) => {
              const type = available
                .find((target) => target.name === name)
                ?.type.replaceAll("array<", "list<");
              if (type)
                change(
                  name,
                  defaultEncoding(
                    isGraphReturn(name) && signature.nodeReferences === "return"
                      ? "custom"
                      : graphPresetType("edgeList") === type
                        ? "edgeList"
                        : graphPresetType("successor") === type
                          ? "successor"
                          : "custom",
                  ),
                );
            }}
          />
        )}
      </div>
    </details>
  );
}
