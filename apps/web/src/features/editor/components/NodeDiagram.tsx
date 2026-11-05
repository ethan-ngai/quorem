/** @file NodeDiagram.tsx @description React Flow renders the shared case canvas with built-in edges and controls. @module editor */
import { Tooltip } from "../../../ui/Tooltip";
import { Icon } from "../../../ui/Icon";
import { flextree } from "d3-flextree";
import {
  getNodesBounds,
  getViewportForBounds,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  buildCaseDiagram,
  nodeValueType,
  type DiagramNode,
  type CaseDiagram,
} from "../nodeDiagram";
import { parseNodeLiteral, type NodeContext } from "../nodeLiterals";
import type { WireValue } from "../typedValues";

const MAX_NODE_WIDTH = 240;
const textMeasure = document.createElement("canvas").getContext("2d");
function textWidth(text: string, size: number) {
  if (!textMeasure) return text.length * size;
  textMeasure.font = `${size}px "JetBrains Mono", Consolas, monospace`;
  return textMeasure.measureText(text).width;
}
function nodeBadges(node: DiagramNode): { label: string; icon?: "target" | "output" }[] {
  return [
    ...(node.names.length ? [{ label: node.names.join(", ") }] : []),
    ...(node.outputs ?? []).map((role) =>
      role === "expected"
        ? { label: "Expected", icon: "target" as const }
        : { label: "Output", icon: "output" as const },
    ),
  ];
}
function emptyNodeHint(node: DiagramNode) {
  const list = node.type.startsWith("ListNode");
  const expected = node.outputs?.includes("expected");
  const actual = node.outputs?.includes("actual");
  const role =
    expected && actual ? "Expected and returned" : expected ? "Expected" : actual ? "Returned" : "";
  return (
    <>
      <strong>
        {role ? `${role} empty` : "Empty"} {list ? "linked list" : "tree"}
      </strong>
      <br />
      <code>{node.names.length ? `${node.names.join(", ")} = null` : "null"}</code>
    </>
  );
}
const nodeWidth = (node: DiagramNode) => {
  const badges = nodeBadges(node);
  const header =
    badges.reduce((width, badge) => width + (badge.icon ? 12 : textWidth(badge.label, 9)), 0) +
    Math.max(0, badges.length - 1) * 6;
  return Math.min(
    MAX_NODE_WIDTH,
    Math.ceil(Math.max(34, textWidth(node.label, 11) + 20, header + 20)),
  );
};
const nodeHeight = (node: DiagramNode) => (nodeBadges(node).length ? 42 : 28);

type PreviewNode = Node<{ label: ReactNode; list: boolean }>;
function StructureNode({ data }: NodeProps<PreviewNode>) {
  return (
    <>
      <Handle id="in" type="target" position={data.list ? Position.Left : Position.Top} />
      {data.label}
      <Handle id="out" type="source" position={data.list ? Position.Right : Position.Bottom} />
      {data.list && (
        <>
          <Handle id="loop-in" type="target" position={Position.Bottom} />
          <Handle id="loop-out" type="source" position={Position.Bottom} />
        </>
      )}
    </>
  );
}
const nodeTypes = { default: StructureNode };

/** Bound layout work while retaining original identities on every visible node. */
function position(model: CaseDiagram, limit: number) {
  const byId = new Map(model.nodes.slice(0, limit).map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number; list: boolean }>();
  let top = 22;
  for (const group of model.groups) {
    let height = 0;
    if (group.list) {
      group.roots.forEach((root, row) => {
        let x = 16;
        let current = byId.get(root);
        while (current) {
          positions.set(current.id, {
            x,
            y: top + row * 76 + (42 - nodeHeight(current)) / 2,
            list: true,
          });
          x += nodeWidth(current) + 28;
          current = byId.get(current.children[0]);
        }
        height = Math.max(height, row * 76 + 66);
      });
    } else {
      const forest: DiagramNode = {
        id: "forest",
        type: "",
        label: "",
        names: [],
        missing: false,
        children: group.roots,
      };
      const layout = flextree<DiagramNode>({
        children: (node) =>
          node.children.map((id) => byId.get(id)).filter((node): node is DiagramNode => !!node),
        nodeSize: (node) => [nodeWidth(node.data) + 14, nodeHeight(node.data) + 36],
        spacing: 4,
      });
      const tree = layout.hierarchy(forest);
      layout(tree);
      const nodes = tree.descendants().slice(1);
      const centers = new Map(nodes.map((node) => [node.data.id, node.x]));
      // Odd child groups align their middle branch vertically, avoiding tiny routed doglegs.
      for (const node of [...nodes].reverse())
        if (node.children && node.children.length % 2 === 1)
          centers.set(
            node.data.id,
            centers.get(node.children[Math.floor(node.children.length / 2)].data.id)!,
          );
      const left = nodes.reduce(
        (left, node) => Math.min(left, centers.get(node.data.id)! - nodeWidth(node.data) / 2),
        0,
      );
      for (const node of nodes) {
        const y = node.y - (nodeHeight(forest) + 36);
        positions.set(node.data.id, {
          x: centers.get(node.data.id)! - nodeWidth(node.data) / 2 - left + 16,
          y: top + y,
          list: false,
        });
        height = Math.max(height, y + nodeHeight(node.data) + 16);
      }
    }
    top += height + 20;
  }
  return positions;
}

export default function NodeDiagramView({
  width,
  onNaturalWidth,
  context,
  expected,
  actual,
  expectedSource,
  choose,
  choosing,
}: {
  width: number;
  onNaturalWidth: (width: number) => void;
  context: NodeContext;
  expected?: WireValue;
  actual?: WireValue;
  expectedSource?: string;
  choose: (type: string, reference: string) => void;
  choosing?: string;
}) {
  const canvasId = useId();
  const [selected, setSelected] = useState<string>();
  const built = useMemo(() => {
    try {
      let expectation = expected;
      if (expectedSource !== undefined) {
        try {
          expectation = parseNodeLiteral(
            nodeValueType(context.signature.returnType)!,
            expectedSource,
            context,
          );
        } catch {
          /* Inputs remain available while the expectation is incomplete. */
        }
      }
      return { model: buildCaseDiagram(context, expectation, actual) };
    } catch {
      return { error: "Complete the case literals to preview their structures." };
    }
  }, [context, expected, actual, expectedSource]);
  const geometry = useMemo(() => {
    if (!built.model) return;
    const model = built.model,
      positions = position(model, 80);
    const active = selected;
    const nodes: PreviewNode[] = model.nodes
      .filter((node) => positions.has(node.id))
      .map((node) => {
        const location = positions.get(node.id)!;
        return {
          id: node.id,
          type: "default",
          position: { x: location.x, y: location.y },
          sourcePosition: location.list ? Position.Right : Position.Bottom,
          targetPosition: location.list ? Position.Left : Position.Top,
          data: {
            list: location.list,
            label: (
              <>
                {nodeBadges(node).length > 0 && (
                  <span className="node-preview-name">
                    {nodeBadges(node).map(({ label, icon }) =>
                      icon ? (
                        <Tooltip key={icon} content={label}>
                          <span
                            tabIndex={0}
                            aria-label={label}
                            className="node-preview-badge nodrag nopan"
                          >
                            <Icon name={icon} width={12} height={12} />
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="node-preview-badge is-name" key={label}>
                          {label}
                        </span>
                      ),
                    )}
                  </span>
                )}
                {node.reference ? (
                  <Tooltip content={node.reference} open={node.id === active}>
                    <span className="node-preview-value" tabIndex={0} aria-label={node.reference}>
                      {node.label}
                    </span>
                  </Tooltip>
                ) : node.empty ? (
                  <Tooltip content={emptyNodeHint(node)}>
                    <span className="node-preview-value" tabIndex={0}>
                      {node.label}
                    </span>
                  </Tooltip>
                ) : (
                  <span className="node-preview-value">{node.label}</span>
                )}
              </>
            ),
          },
          className: [
            node.missing ? "is-missing" : "",
            node.empty ? "is-empty" : "",
            node.outputs?.includes("expected") ||
            (node.outputs?.includes("actual") && model.outputMatchesExpected === true)
              ? "is-success"
              : node.outputs?.includes("actual") && model.outputMatchesExpected === false
                ? "is-error"
                : "",
          ]
            .filter(Boolean)
            .join(" "),
          selected: node.id === active,
          selectable: !node.missing && !node.empty,
          focusable: !node.missing && !node.empty,
          ariaLabel: `${node.reference ?? "Node"}, value ${node.label}${
            nodeBadges(node).length
              ? `, ${nodeBadges(node)
                  .map((badge) => badge.label)
                  .join(", ")}`
              : ""
          }`,
          width: nodeWidth(node),
          height: nodeHeight(node),
          style: { padding: "4px 8px" },
        };
      });
    const ids = new Set(nodes.map((node) => node.id));
    const edges: Edge[] = model.edges
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map((edge) => ({
        id: `${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        sourceHandle:
          edge.tail && Math.abs(positions.get(edge.from)!.y - positions.get(edge.to)!.y) < 42
            ? "loop-out"
            : "out",
        targetHandle: edge.tail ? "loop-in" : "in",
        type: "smoothstep",
        pathOptions: { borderRadius: edge.tail ? 12 : 10, offset: edge.tail ? 16 : 8 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          markerUnits: "userSpaceOnUse",
          color: edge.tail ? "var(--color-primary)" : "var(--color-text-secondary)",
        },
        className: edge.tail ? "is-reference" : undefined,
        style: {
          stroke: edge.tail ? "var(--color-primary)" : "var(--color-text-secondary)",
          strokeWidth: 1.2,
        },
        selectable: false,
        focusable: false,
      }));
    const bounds = getNodesBounds(nodes);
    const naturalWidth = Math.ceil(bounds.width + 8);
    const height = Math.max(
      40,
      Math.min(320, (bounds.height + 8) * Math.min(1, width / naturalWidth)),
    );
    const viewport = getViewportForBounds(bounds, width, height, 0.01, 1, "4px");
    return { nodes, edges, height, viewport, naturalWidth, active };
  }, [built, selected, width]);
  const naturalWidth = geometry?.nodes.length ? geometry.naturalWidth : undefined;
  useEffect(() => {
    if (naturalWidth) onNaturalWidth(naturalWidth);
  }, [naturalWidth, onNaturalWidth]);
  if (!built.model || !geometry) return <p className="node-preview-message">{built.error}</p>;
  const model = built.model;
  if (!model.nodes.length) return null;
  const focused = model.nodes.find((node) => node.id === geometry.active);
  return (
    <>
      {choosing && <p className="node-preview-hint">Select a node for {choosing}</p>}
      <div
        className="node-preview-canvas"
        style={{ height: geometry.height }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setSelected(undefined);
        }}
      >
        <ReactFlow
          id={canvasId}
          nodeTypes={nodeTypes}
          nodes={geometry.nodes}
          edges={geometry.edges}
          viewport={geometry.viewport}
          minZoom={0.01}
          maxZoom={1}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          panOnScroll={false}
          panActivationKeyCode={null}
          zoomActivationKeyCode={null}
          autoPanOnNodeFocus={false}
          preventScrolling={false}
          onPaneClick={() => setSelected(undefined)}
          onNodeClick={(_, node) => {
            if (!node.selectable) return;
            setSelected(node.id);
            const entry = model.nodes.find((item) => item.id === node.id);
            if (entry?.reference) choose(entry.type, entry.reference);
          }}
          onNodesChange={(changes) => {
            const change = changes.find((change) => change.type === "select" && change.selected);
            if (change?.type === "select") setSelected(change.id);
          }}
        />
      </div>
      {focused && textWidth(focused.label, 11) + 20 > MAX_NODE_WIDTH && (
        <pre className="node-preview-detail" aria-label="Selected node value" tabIndex={0}>
          {focused.label}
        </pre>
      )}
      {geometry.nodes.length < model.nodes.length && (
        <div className="node-preview-caption" aria-live="polite">
          <span>
            Showing {geometry.nodes.length} of {model.nodes.length} entries
          </span>
        </div>
      )}
    </>
  );
}
