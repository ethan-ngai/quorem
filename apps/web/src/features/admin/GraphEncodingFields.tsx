/** @file GraphEncodingFields.tsx @description Optional per-value graph encoding controls. @module admin */
import {
  GRAPH_RETURN,
  GRAPH_RETURN_LIST,
  graphPresetType,
  graphReturnSlot,
  isGraphReturn,
  type GraphEncoding,
} from "@quorem/questions";
import type { ReactNode } from "react";
import type { Signature } from "@quorem/contracts";
import { SegmentedControl } from "../../ui/SegmentedControl";
import * as Popover from "../../ui/Popover";
import { Tooltip } from "../../ui/Tooltip";
import { SelectField } from "../../ui/SelectField";
import { ArrowRightLeft, Hash, ListOrdered, Network, Settings, Weight } from "lucide-react";
import { SearchableTypeSelect } from "./SearchableTypeSelect";
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

export function defaultGraphEncoding(type: string, customOnly = false): GraphEncoding {
  const native = type.replaceAll("array<", "list<");
  if (customOnly) return { kind: "custom", directed: false };
  if (native === graphPresetType("edgeList")) return { kind: "edgeList", directed: false };
  if (native === graphPresetType("successor")) return { kind: "successor" };
  return { kind: "custom", directed: false };
}

export function withGraphEncoding(
  signature: Signature,
  name: string,
  encoding?: GraphEncoding,
): Signature {
  const next = { ...signature.graphEncodings };
  if (encoding) next[name] = encoding;
  else delete next[name];
  const updated = { ...signature, graphEncodings: Object.keys(next).length ? next : undefined };
  const type = encoding && graphPresetType(encoding.kind);
  if (name === GRAPH_RETURN_LIST && encoding) {
    const wrapper = signature.returnType.startsWith("array<") ? "array" : "list";
    return {
      ...updated,
      returnType: type ? `${wrapper}<${type}>` : signature.returnType,
      outputOrder: "ordered",
    };
  }
  if (!type) return updated;
  if (name === GRAPH_RETURN) {
    return signature.returnType.replaceAll("array<", "list<") === type
      ? updated
      : { ...updated, returnType: type };
  }
  if (isGraphReturn(name)) return updated;
  return {
    ...updated,
    parameters: signature.parameters.map((parameter) =>
      parameter.name !== name || parameter.type.replaceAll("array<", "list<") === type
        ? parameter
        : { ...parameter, type, input: undefined },
    ),
  };
}

function GraphRepresentationField({
  title,
  encoding,
  disabled,
  customOnly,
  onChange,
}: {
  title: string;
  encoding: GraphEncoding;
  disabled: boolean;
  customOnly?: boolean;
  onChange: (encoding: GraphEncoding) => void;
}) {
  return (
    <SelectField
      label={`Graph representation for ${title}`}
      className="graph-representation-select"
      value={encoding.kind}
      options={options.filter(({ value }) => {
        const type = graphPresetType(value);
        return value === encoding.kind || !type || !customOnly;
      })}
      disabled={disabled}
      onChange={(value) => {
        const kind = value as GraphEncoding["kind"];
        onChange({
          kind,
          directed:
            kind === "successor"
              ? undefined
              : encoding.kind === "successor" || (encoding.directed ?? false),
          ...(kind === "custom"
            ? { nodeValueType: encoding.nodeValueType }
            : { countParameter: encoding.countParameter, firstNode: encoding.firstNode }),
        });
      }}
    />
  );
}

export function GraphEncodingFields({
  signature,
  name,
  title,
  encoding,
  disabled,
  customType,
  onChange,
}: {
  signature: Signature;
  name: string;
  title: string;
  encoding: GraphEncoding;
  disabled: boolean;
  customType?: ReactNode;
  onChange: (encoding: GraphEncoding) => void;
}) {
  const output = isGraphReturn(name);
  const encodings = signature.graphEncodings ?? {};
  return (
    <div className="graph-binding-list">
      <div className="admin-field">
        <span className="admin-icon-label">
          <Network size={14} aria-hidden="true" /> Representation
        </span>
        <GraphRepresentationField
          title={title}
          encoding={encoding}
          disabled={disabled}
          customOnly={output && signature.nodeReferences === "return"}
          onChange={onChange}
        />
      </div>
      {encoding.kind === "custom" && customType}
      <div className="graph-binding-options">
        {encoding.kind !== "successor" && (
          <div className="admin-field">
            <span className="admin-icon-label">
              <ArrowRightLeft size={14} aria-hidden="true" /> Direction
            </span>
            <SegmentedControl
              compact
              label={`Direction for ${title}`}
              value={encoding.directed === undefined ? "" : String(encoding.directed)}
              disabled={disabled}
              options={[
                { value: "true", label: "Directed" },
                { value: "false", label: "Undirected" },
              ]}
              onChange={(value) => onChange({ ...encoding, directed: value === "true" })}
            />
          </div>
        )}
        {encoding.kind !== "custom" && (
          <>
            {!output && (
              <Field label="Node count argument" icon={<Hash size={14} aria-hidden="true" />}>
                <SelectField
                  label={`Node count for ${title}`}
                  value={encoding.countParameter ?? "$none"}
                  disabled={disabled}
                  options={[
                    { value: "$none", label: "None" },
                    ...signature.parameters
                      .filter((p) => p.type === "int" && !encodings[p.name] && p.name !== name)
                      .map((p) => ({ value: p.name, label: p.name })),
                  ]}
                  onChange={(value) =>
                    onChange({
                      ...encoding,
                      countParameter: value === "$none" ? undefined : value,
                    })
                  }
                />
              </Field>
            )}
            {(encoding.kind !== "edgeList" || encoding.countParameter) && (
              <div className="admin-field">
                <span className="admin-icon-label">
                  <ListOrdered size={14} aria-hidden="true" /> First node
                </span>
                <SegmentedControl
                  compact
                  label={`First node for ${title}`}
                  value={String(encoding.firstNode ?? 0)}
                  disabled={disabled}
                  options={[
                    { value: "0", label: "0" },
                    { value: "1", label: "1" },
                  ]}
                  onChange={(value) => onChange({ ...encoding, firstNode: value === "1" ? 1 : 0 })}
                />
              </div>
            )}
            {encoding.kind === "edgeList" && (
              <Field
                label="Weight type"
                icon={<Weight size={14} aria-hidden="true" />}
                hint="Choosing None removes weights from test cases."
              >
                <SearchableTypeSelect
                  label={`Weight type for ${title}`}
                  value={encoding.edgeValue ? "int" : "None"}
                  choices={["None", "int"]}
                  searchAliases={{ int: "Integer" }}
                  disabled={disabled}
                  onChange={(type) =>
                    onChange({
                      ...encoding,
                      edgeValue: type === "int" ? (encoding.edgeValue ?? "Weight") : undefined,
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
                    onChange({ ...encoding, matrixDiagonal: value === "1" ? 1 : 0 })
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
      {encoding.kind === "custom" && (
        <div className="graph-binding-options">
          {(["nodeValueType", "edgeValueType"] as const).map((field) => (
            <ValueTypeField
              key={field}
              label={field === "nodeValueType" ? "Node value type" : "Edge value type"}
              value={encoding[field]}
              disabled={disabled}
              onClear={() => onChange({ ...encoding, [field]: undefined })}
              onChange={(value) => onChange({ ...encoding, [field]: value })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function GraphSettingsMenu({
  title,
  disabled,
  children,
}: {
  title: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Tooltip content="Graph settings">
        <Popover.Trigger asChild>
          <button
            type="button"
            className="icon-button graph-settings-trigger"
            aria-label={`Graph settings for ${title}`}
            disabled={disabled}
          >
            <Settings size={14} aria-hidden="true" />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="graph-settings-popover"
          aria-label="Graph settings"
          align="start"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function LegacyReturnGraphSlots({ slots }: { slots: [string, GraphEncoding][] }) {
  return (
    <div className="graph-return-slots" role="group" aria-label="Legacy return graph formats">
      {[...slots]
        .sort(([left], [right]) => graphReturnSlot(left)! - graphReturnSlot(right)!)
        .map(([name, encoding]) => (
          <div className="graph-return-slot" key={name}>
            <code>[{graphReturnSlot(name)}]</code>
            <span>{options.find(({ value }) => value === encoding.kind)?.label}</span>
          </div>
        ))}
    </div>
  );
}
