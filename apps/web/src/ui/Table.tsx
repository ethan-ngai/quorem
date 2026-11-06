/** @file Table.tsx @description Shared list table semantics, motion and row interaction. @module ui */
import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useChangeMotion } from "./useChangeMotion";
import "./table.css";

export function Table({
  label,
  heading,
  children,
  className,
  rowGroups = false,
  density = "regular",
}: {
  label: string;
  heading: ReactNode;
  children: ReactNode;
  className?: string;
  rowGroups?: boolean;
  density?: "regular" | "compact";
}) {
  return (
    <table data-density={density} className={className ? `data-table ${className}` : "data-table"}>
      <caption className="sr-only">{label}</caption>
      <thead>{heading}</thead>
      {rowGroups ? children : <TableBody>{children}</TableBody>}
    </table>
  );
}

export function TableBody({
  children,
  animateChanges = true,
}: {
  children: ReactNode;
  animateChanges?: boolean;
}) {
  const rowKeys = Children.toArray(children).map((row) => (isValidElement(row) ? row.key : row));
  const body = useChangeMotion<HTMLTableSectionElement>(
    animateChanges ? JSON.stringify(rowKeys) : undefined,
  );
  return (
    <tbody ref={body} className="motion-reveal">
      {children}
    </tbody>
  );
}

/** Keep the title keyboard accessible and leave nested controls in charge of their clicks. */
export function TableRow({
  onOpen,
  ...props
}: Omit<ComponentPropsWithoutRef<"tr">, "onClick"> & {
  onOpen?: MouseEventHandler<HTMLTableRowElement>;
}) {
  return (
    <tr
      {...props}
      data-openable={!!onOpen}
      onClick={
        onOpen &&
        ((event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              "a, button, input, select, textarea, summary, [role=button], [role=checkbox]",
            )
          )
            return;
          onOpen(event);
        })
      }
    />
  );
}
