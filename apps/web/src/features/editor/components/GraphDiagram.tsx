/** @file GraphDiagram.tsx @description Bounded previews of authored case graphs. @module editor */
import { useId } from "react";
import type { QuestionGraph } from "@quorem/questions";

const maxNodes = 24;
const maxEdges = 48;
const nodeRadius = 13;
const weightGap = 13;
const markerGap = 2;
type Point = { x: number; y: number };

function inset(from: Point, toward: Point, amount: number): Point {
  const scale = amount / Math.hypot(toward.x - from.x, toward.y - from.y);
  return { x: from.x + (toward.x - from.x) * scale, y: from.y + (toward.y - from.y) * scale };
}

const coords = ({ x, y }: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;

export default function GraphDiagram({ graph, label }: { graph: QuestionGraph; label: string }) {
  const marker = useId();
  const count = graph.nodes.length;
  if (count > maxNodes || graph.edges.length > maxEdges)
    return (
      <p className="node-preview-message">
        {label}: {count} nodes, {graph.edges.length} edges
      </p>
    );
  if (!count) return <p className="node-preview-message">{label}: empty graph</p>;

  // Size the ring from the distance between neighbors so dense graphs keep their node clearance.
  const radius = count === 1 ? 0 : Math.max(31, 21 / Math.sin(Math.PI / count));
  const points = new Map(
    graph.nodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / count - (count === 2 ? Math.PI : Math.PI / 2);
      return [node, { x: radius * Math.cos(angle), y: radius * Math.sin(angle), index }] as const;
    }),
  );
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  function include({ x, y }: Point, rx: number, ry = rx) {
    left = Math.min(left, x - rx);
    right = Math.max(right, x + rx);
    top = Math.min(top, y - ry);
    bottom = Math.max(bottom, y + ry);
  }
  for (const point of points.values()) include(point, nodeRadius + 4);
  const routes = new Map<string, number>();
  const edges = graph.edges.map(({ from, to, value }) => {
    const a = points.get(from)!;
    const b = points.get(to)!;
    const key = [Math.min(a.index, b.index), Math.max(a.index, b.index)].join("/");
    const occurrence = routes.get(key) ?? 0;
    routes.set(key, occurrence + 1);
    const weight = value === undefined ? undefined : String(value).slice(0, 12);
    let path: string;
    let weightPosition: Point;
    if (from === to) {
      const loop = 22 + occurrence * 7;
      const c1 = { x: a.x - loop, y: a.y - loop };
      const c2 = { x: a.x + loop, y: a.y - loop };
      const start = { x: a.x - 8, y: a.y - 10 };
      const end = { x: a.x + 8, y: a.y - 11 };
      path = `M ${coords(start)} C ${coords(c1)} ${coords(c2)} ${coords(end)}`;
      include(c1, 2);
      include(c2, 2);
      weightPosition = { x: a.x, y: (start.y + end.y + 6 * c1.y) / 8 - weightGap };
    } else {
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      // Use a stable normal so reverse edges keep the same routing and label sides.
      const sign = a.index < b.index ? 1 : -1;
      const nx = (sign * (a.y - b.y)) / distance;
      const ny = (sign * (b.x - a.x)) / distance;
      const side = occurrence % 2 ? 1 : -1;
      const bend = side * Math.ceil(occurrence / 2) * 19;
      const control = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
      const start = inset(a, control, nodeRadius);
      const end = inset(b, control, nodeRadius + (graph.directed ? markerGap : 0));
      path = `M ${coords(start)} Q ${coords(control)} ${coords(end)}`;
      const midpoint = {
        x: (start.x + 2 * control.x + end.x) / 4,
        y: (start.y + 2 * control.y + end.y) / 4,
      };
      include(midpoint, 4);
      const labelSide = occurrence ? side : midpoint.x * nx + midpoint.y * ny < 0 ? -1 : 1;
      weightPosition = {
        x: midpoint.x + nx * labelSide * weightGap,
        y: midpoint.y + ny * labelSide * weightGap,
      };
    }
    if (weight !== undefined) include(weightPosition, weight.length * 3.5 + 4, 8);
    return { from, to, value, weight, weightPosition, path };
  });
  const width = Math.ceil(right - left);
  const height = Math.ceil(bottom - top);
  return (
    <figure className="case-graph">
      <figcaption className="node-preview-hint">{label}</figcaption>
      <svg
        width={width}
        height={height}
        viewBox={`${left} ${top} ${width} ${height}`}
        role="img"
        aria-label={`${label}: ${graph.directed ? "directed" : "undirected"} graph with ${count} nodes and ${graph.edges.length} ${graph.edges.length === 1 ? "edge" : "edges"}`}
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 8 8"
            markerWidth="6"
            markerHeight="6"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 Z" fill="var(--color-text-secondary)" />
          </marker>
        </defs>
        {edges.map(({ from, to, value, weight, weightPosition, path }, index) => (
          <g key={index}>
            <path
              d={path}
              fill="none"
              stroke="var(--color-text-secondary)"
              markerEnd={graph.directed ? `url(#${marker})` : undefined}
            />
            {weight !== undefined && (
              <text
                className="case-graph-weight"
                x={weightPosition.x}
                y={weightPosition.y}
                dominantBaseline="central"
              >
                {weight}
              </text>
            )}
            <title>
              {String(from)} {graph.directed ? "→" : "—"} {String(to)}
              {value === undefined ? "" : ` (${value})`}
            </title>
          </g>
        ))}
        {[...points].map(([node, { x, y, index }]) => (
          <g key={index}>
            <circle
              cx={x}
              cy={y}
              r={nodeRadius}
              fill="var(--color-background)"
              stroke="var(--color-text-secondary)"
            />
            <text x={x} y={y} dominantBaseline="central">
              {String(node).length <= 3 ? node : `${String(node).slice(0, 2)}…`}
            </text>
            <title>{String(node)}</title>
          </g>
        ))}
      </svg>
    </figure>
  );
}
