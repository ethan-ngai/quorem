/** @file GraphDiagram.tsx @description Bounded previews of authored case graphs. @module editor */
import { useId } from "react";
import type { QuestionGraph } from "@quorem/questions";

const maxNodes = 24;
const maxEdges = 48;
const center = 100;

export default function GraphDiagram({
  graph,
  label,
  caption,
}: {
  graph: QuestionGraph;
  label: string;
  caption: boolean;
}) {
  const marker = useId();
  if (graph.nodes.length > maxNodes || graph.edges.length > maxEdges)
    return (
      <p className="node-preview-message">
        {label}: {graph.nodes.length} nodes, {graph.edges.length} edges
      </p>
    );
  if (!graph.nodes.length) return <p className="node-preview-message">{label}: empty graph</p>;
  const points = new Map(
    graph.nodes.map((node, index) => {
      const angle =
        (2 * Math.PI * index) / graph.nodes.length -
        (graph.nodes.length === 2 ? Math.PI : Math.PI / 2);
      const radius = graph.nodes.length === 1 ? 0 : Math.min(72, 26 + graph.nodes.length * 5);
      return [
        node,
        { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle), index },
      ] as const;
    }),
  );
  const routes = new Map<string, number>();
  const margin = graph.nodes.length <= 3 && graph.edges.length <= 3 ? 30 : 26;
  const all = [...points.values()];
  const left = Math.min(...all.map(({ x }) => x)) - margin;
  const top = Math.min(...all.map(({ y }) => y)) - margin;
  const right = Math.max(...all.map(({ x }) => x)) + margin;
  const bottom = Math.max(...all.map(({ y }) => y)) + margin;
  return (
    <figure className="case-graph">
      {caption && <figcaption className="node-preview-hint">{label}</figcaption>}
      <svg
        viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
        role="img"
        aria-label={`${label}: ${graph.directed ? "directed" : "undirected"} graph with ${graph.nodes.length} nodes and ${graph.edges.length} ${graph.edges.length === 1 ? "edge" : "edges"}`}
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
        {graph.edges.map(({ from, to, value }, index) => {
          const a = points.get(from)!;
          const b = points.get(to)!;
          const key = [Math.min(a.index, b.index), Math.max(a.index, b.index)].join("/");
          const occurrence = routes.get(key) ?? 0;
          routes.set(key, occurrence + 1);
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          const ux = distance ? (b.x - a.x) / distance : 0;
          const uy = distance ? (b.y - a.y) / distance : 0;
          const bend =
            Math.min(52, Math.ceil(occurrence / 2) * 13) *
            (occurrence % 2 ? 1 : -1) *
            (a.index <= b.index ? 1 : -1);
          const cx = (a.x + b.x) / 2 - uy * bend;
          const cy = (a.y + b.y) / 2 + ux * bend;
          const loop = 17 + occurrence * 7;
          const path = distance
            ? `M ${a.x + ux * 9} ${a.y + uy * 9} Q ${cx} ${cy} ${b.x - ux * 10} ${b.y - uy * 10}`
            : `M ${a.x - 5} ${a.y - 7} C ${a.x - loop} ${a.y - loop} ${a.x + loop} ${a.y - loop} ${a.x + 5} ${a.y - 7}`;
          return (
            <g key={index}>
              <path
                d={path}
                fill="none"
                stroke="var(--color-text-secondary)"
                markerEnd={graph.directed ? `url(#${marker})` : undefined}
              />
              {value !== undefined && (
                <text
                  x={distance ? (cx + (a.x + b.x) / 2) / 2 : a.x}
                  y={distance ? (cy + (a.y + b.y) / 2) / 2 - 3 : a.y - loop}
                >
                  {String(value).slice(0, 12)}
                </text>
              )}
              <title>
                {String(from)} {graph.directed ? "→" : "—"} {String(to)}
                {value === undefined ? "" : ` (${value})`}
              </title>
            </g>
          );
        })}
        {[...points].map(([node, { x, y, index }]) => (
          <g key={index}>
            <circle
              cx={x}
              cy={y}
              r="9"
              fill="var(--color-background)"
              stroke="var(--color-border)"
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
