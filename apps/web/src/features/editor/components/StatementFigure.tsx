/** @file StatementFigure.tsx @description Manually authored problem description figures. @module editor */
import "./statement-figure.css";
import { gridRows, ValueGrid } from "./ValueGrid";

const maxFigureLength = 32_768;

export type ExampleArgument = (example: number | undefined, argument: string) => unknown;

function exampleIndex(grid: object) {
  if (!("example" in grid)) return undefined;
  if (typeof grid.example !== "number" || !Number.isInteger(grid.example) || grid.example < 1)
    throw new Error("Invalid example number.");
  return grid.example;
}

function readGrid(source: string, exampleArgument?: ExampleArgument) {
  try {
    const grid: unknown = JSON.parse(source);
    if (!grid || typeof grid !== "object") return;
    const value =
      "cells" in grid
        ? grid.cells
        : "argument" in grid && typeof grid.argument === "string"
          ? exampleArgument?.(exampleIndex(grid), grid.argument)
          : undefined;
    const cells = gridRows(value, 256);
    if (!cells || cells.length > 32) return;
    const width = cells[0]!.length;
    if (
      width > 32 ||
      cells.some((row) => row.some((cell) => typeof cell === "string" && cell.length > 80))
    )
      return;
    const highlights = "highlights" in grid ? grid.highlights : [];
    if (!Array.isArray(highlights) || highlights.length > cells.length * width) return;
    const highlighted = new Set<number>();
    for (const cell of highlights) {
      if (!Array.isArray(cell) || cell.length !== 2) return;
      const [row, column] = cell;
      if (
        typeof row !== "number" ||
        typeof column !== "number" ||
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 0 ||
        row >= cells.length ||
        column < 0 ||
        column >= width
      )
        return;
      highlighted.add(row * width + column);
    }
    return { cells, highlighted };
  } catch {
    return;
  }
}

/** Keep authored SVG in the browser's image context, isolated from the document. */
function svgImage(source: string, label: string) {
  if (!/^<svg[\s>][\s\S]*<\/svg>$/u.test(source)) return;
  try {
    return (
      <img
        className="statement-figure-svg"
        src={`data:image/svg+xml,${encodeURIComponent(source)}`}
        alt={label}
      />
    );
  } catch {
    return;
  }
}

export function renderStatementFigure(
  kind: string,
  source: string,
  label?: string | null,
  exampleArgument?: ExampleArgument,
) {
  if (source.length > maxFigureLength) return;
  if (kind === "svg") return svgImage(source.trim(), label?.trim() || "Diagram");
  if (kind !== "grid") return;
  const grid = readGrid(source, exampleArgument);
  if (!grid) return;
  return (
    <figure className="statement-figure-grid">
      <ValueGrid rows={grid.cells} highlighted={grid.highlighted} label={label?.trim() || "Grid"} />
    </figure>
  );
}
